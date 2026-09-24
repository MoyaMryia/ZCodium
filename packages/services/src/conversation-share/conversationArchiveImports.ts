import { randomUUID } from "node:crypto";
import { CONVERSATION_ARCHIVE_CHUNK_BYTES, CONVERSATION_ARCHIVE_LIMITS } from "@zcode/shared";
import { ConversationShareServiceError } from "./conversationShare.js";

const IDLE_MS = 600_000;
interface Transfer {
  owner: symbol;
  bytes: Buffer;
  received: number;
  consuming: boolean;
  expiresAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** 分块传输与正在校验/提交的文件共用有界槽，不把字节写入业务状态或日志。 */
export class ConversationArchiveImports {
  private readonly transfers = new Map<string, Transfer>();
  constructor(private readonly now: () => number = Date.now) {}

  begin(owner: symbol, byteLength: number): string {
    for (const [id, entry] of this.transfers) {
      if (!entry.consuming && entry.expiresAt <= this.now()) this.remove(id);
    }
    if (
      !Number.isSafeInteger(byteLength) ||
      byteLength <= 0 ||
      byteLength > CONVERSATION_ARCHIVE_LIMITS.archiveBytes
    ) {
      throw new ConversationShareServiceError(
        "limit_exceeded",
        "Conversation import exceeds the transfer limit",
      );
    }
    if (this.transfers.size >= 2)
      throw new ConversationShareServiceError("operation_busy", "Conversation import is busy");
    const id = randomUUID();
    const entry: Transfer = {
      owner,
      bytes: Buffer.alloc(byteLength),
      received: 0,
      consuming: false,
      expiresAt: 0,
    };
    this.transfers.set(id, entry);
    this.touch(id, entry);
    return id;
  }

  append(owner: symbol, id: string, offset: number, encoded: string): void {
    const entry = this.get(owner, id);
    if (
      entry.consuming ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > entry.received ||
      offset >= entry.bytes.length ||
      typeof encoded !== "string"
    )
      this.invalid();
    const expected = Math.min(CONVERSATION_ARCHIVE_CHUNK_BYTES, entry.bytes.length - offset);
    if (encoded.length !== Math.ceil(expected / 3) * 4) this.invalid();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== expected || bytes.toString("base64") !== encoded) this.invalid();
    if (offset < entry.received) {
      if (
        offset + bytes.length > entry.received ||
        !entry.bytes.subarray(offset, offset + bytes.length).equals(bytes)
      )
        this.invalid();
    } else {
      bytes.copy(entry.bytes, offset);
      entry.received += bytes.length;
    }
    this.touch(id, entry);
  }

  async consume<T>(owner: symbol, id: string, run: (bytes: Buffer) => Promise<T>): Promise<T> {
    const entry = this.get(owner, id);
    if (entry.consuming || entry.received !== entry.bytes.length) this.invalid();
    entry.consuming = true;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      return await run(entry.bytes);
    } finally {
      this.remove(id);
    }
  }

  release(owner: symbol, id: string): void {
    const entry = this.transfers.get(id);
    if (entry?.owner === owner && !entry.consuming) this.remove(id);
  }

  private get(owner: symbol, id: string): Transfer {
    const entry = this.transfers.get(id);
    if (!entry || entry.owner !== owner || (!entry.consuming && entry.expiresAt <= this.now())) {
      if (entry?.owner === owner && !entry.consuming) this.remove(id);
      throw new ConversationShareServiceError(
        "not_found",
        "Conversation import transfer is unavailable",
      );
    }
    return entry;
  }

  private touch(id: string, entry: Transfer): void {
    if (entry.timer) clearTimeout(entry.timer);
    entry.expiresAt = this.now() + IDLE_MS;
    entry.timer = setTimeout(() => this.remove(id), IDLE_MS);
    entry.timer.unref();
  }

  private remove(id: string): void {
    const entry = this.transfers.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    this.transfers.delete(id);
  }

  private invalid(): never {
    throw new ConversationShareServiceError(
      "invalid_contract",
      "Invalid conversation import transfer",
    );
  }
}
