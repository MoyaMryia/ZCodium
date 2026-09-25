import {
  CONVERSATION_ARCHIVE_CHUNK_BYTES,
  CONVERSATION_ARCHIVE_LIMITS,
  type ConversationArchiveExport,
  type IPlatformService,
  type SaveFileResult,
} from "@zcode/shared";
import type { IConversationShareService } from "@zcode/services";

/** 字节仅存在于本次操作中，保存或取消后释放 Host 句柄，不写入 UI store。 */
export async function saveConversationExport(
  service: Pick<IConversationShareService, "readExportChunk" | "releaseExport">,
  platform: Pick<IPlatformService, "saveFile">,
  archive: ConversationArchiveExport,
): Promise<SaveFileResult> {
  try {
    if (
      !platform.saveFile ||
      !Number.isSafeInteger(archive.byteLength) ||
      archive.byteLength <= 0 ||
      archive.byteLength > CONVERSATION_ARCHIVE_LIMITS.archiveBytes
    ) {
      throw new Error("Conversation export cannot be saved");
    }
    const bytes = new Uint8Array(archive.byteLength);
    for (let offset = 0; offset < bytes.length; ) {
      const encoded = await service.readExportChunk(archive.archiveId, offset);
      const expected = Math.min(CONVERSATION_ARCHIVE_CHUNK_BYTES, bytes.length - offset);
      if (encoded.length !== Math.ceil(expected / 3) * 4)
        throw new Error("Invalid conversation export chunk");
      const chunk = atob(encoded);
      if (chunk.length !== expected) throw new Error("Incomplete conversation export");
      for (let i = 0; i < chunk.length; i++) bytes[offset + i] = chunk.charCodeAt(i);
      offset += chunk.length;
    }
    return await platform.saveFile({ data: bytes.buffer, suggestedName: archive.suggestedName });
  } finally {
    // 释放失败由 Host 的闲置期限兜底，不把已经完成的保存错误地呈现为失败。
    await service.releaseExport(archive.archiveId).catch(() => undefined);
  }
}
