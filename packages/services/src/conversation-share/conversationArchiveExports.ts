import { randomUUID } from "node:crypto";
import {
  CONVERSATION_ARCHIVE_CHUNK_BYTES,
  CONVERSATION_ARCHIVE_LIMITS,
  type ConversationArchiveExport,
} from "@zcode/shared";
import { ConversationShareServiceError } from "./conversationShare.js";

const IDLE_MS = 10 * 60 * 1000;
interface Entry {
  owner: symbol;
  bytes?: Buffer;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** Host 唯一导出缓冲区；生成中的任务也占槽，防止连续请求绕过内存上限。 */
export class ConversationArchiveExports {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly now: () => number = Date.now) {}

  async create(
    owner: symbol,
    title: string,
    build: () => Promise<Buffer>,
  ): Promise<ConversationArchiveExport> {
    for (const [id, entry] of this.entries) {
      if (entry.bytes && entry.expiresAt <= this.now()) this.remove(id);
    }
    if (this.entries.size >= 2) {
      throw new ConversationShareServiceError(
        "limit_exceeded",
        "Too many active conversation exports",
      );
    }
    const id = randomUUID();
    const entry: Entry = { owner, expiresAt: Infinity };
    this.entries.set(id, entry);
    try {
      const bytes = await build();
      if (bytes.length === 0 || bytes.length > CONVERSATION_ARCHIVE_LIMITS.archiveBytes) {
        throw new ConversationShareServiceError(
          "limit_exceeded",
          "Conversation export exceeds the archive limit",
        );
      }
      entry.bytes = bytes;
      this.touch(id, entry);
      // Windows 保留名、路径分隔符和控制字符不能直接成为保存文件名。
      const name =
        title
          .normalize("NFKC")
          .replace(/[<>:"/\\|?*\p{Cc}]/gu, "-")
          .replace(/[. ]+$/u, "")
          .slice(0, 96)
          .replace(/[. ]+$/u, "") || "conversation";
      return {
        archiveId: id,
        byteLength: bytes.length,
        suggestedName: `conversation-${name}.zcodium`,
      };
    } catch (error) {
      this.remove(id);
      throw error;
    }
  }

  read(owner: symbol, id: string, offset: number): string {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner || !entry.bytes || entry.expiresAt <= this.now()) {
      if (entry?.owner === owner && entry.bytes && entry.expiresAt <= this.now()) this.remove(id);
      throw new ConversationShareServiceError("not_found", "Conversation export is unavailable");
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= entry.bytes.length) {
      throw new ConversationShareServiceError(
        "invalid_contract",
        "Invalid conversation export offset",
      );
    }
    this.touch(id, entry);
    return entry.bytes
      .subarray(offset, offset + CONVERSATION_ARCHIVE_CHUNK_BYTES)
      .toString("base64");
  }

  release(owner: symbol, id: string): void {
    if (this.entries.get(id)?.owner === owner) this.remove(id);
  }

  private touch(id: string, entry: Entry): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.expiresAt = this.now() + IDLE_MS;
    entry.timer = setTimeout(() => this.remove(id), IDLE_MS);
    entry.timer.unref();
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.entries.delete(id);
  }
}
