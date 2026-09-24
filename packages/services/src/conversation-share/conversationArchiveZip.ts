import type { Readable } from "node:stream";
import { fromBuffer, type Entry, type ZipFile } from "yauzl";
import { CONVERSATION_ARCHIVE_LIMITS as LIMITS } from "@zcode/shared";
import { ConversationArchiveError } from "./conversationArchiveValidation.js";

export async function readArchiveStream(stream: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      stream.destroy();
      throw new ConversationArchiveError("limit_exceeded");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

/** 只读固定 manifest/blobs 命名空间；绝不将 ZIP entry 解压成磁盘路径。 */
export async function readConversationArchiveZip(bytes: Uint8Array): Promise<Map<string, Buffer>> {
  if (bytes.byteLength > LIMITS.archiveBytes) throw new ConversationArchiveError("limit_exceeded");
  // 复制输入，调用方在 await 期间修改原缓冲区不能改变已经开始验证的归档。
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(
      Buffer.from(bytes),
      {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, value) => (error ? reject(error) : resolve(value)),
    ),
  );
  if (zip.entryCount > LIMITS.artifacts + 1) throw new ConversationArchiveError("limit_exceeded");
  return new Promise((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    let total = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(entries);
      }
    });
    zip.on("entry", (entry: Entry) => {
      void (async () => {
        const name = entry.fileName;
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        const isManifest = name === "manifest.json";
        if (
          (!isManifest && !/^blobs\/[0-9a-f]{64}$/u.test(name)) ||
          entries.has(name) ||
          (mode !== 0 && mode !== 0o100000) ||
          entry.externalFileAttributes & 0x10 ||
          entry.isEncrypted() ||
          ![0, 8].includes(entry.compressionMethod)
        ) {
          throw new ConversationArchiveError("invalid_archive");
        }
        const limit = isManifest ? LIMITS.manifestBytes : LIMITS.artifactBytes;
        total += entry.uncompressedSize;
        if (
          entry.uncompressedSize > limit ||
          total > LIMITS.manifestBytes + LIMITS.totalArtifactBytes
        ) {
          throw new ConversationArchiveError("limit_exceeded");
        }
        const stream = await new Promise<Readable>((resolveStream, rejectStream) => {
          zip.openReadStream(entry, (error, value) =>
            error ? rejectStream(error) : resolveStream(value),
          );
        });
        const value = await readArchiveStream(stream, Math.min(limit, entry.uncompressedSize));
        if (value.length !== entry.uncompressedSize)
          throw new ConversationArchiveError("integrity_mismatch");
        entries.set(name, value);
        if (!settled) zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
