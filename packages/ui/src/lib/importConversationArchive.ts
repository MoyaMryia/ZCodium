import { CONVERSATION_ARCHIVE_CHUNK_BYTES, CONVERSATION_ARCHIVE_LIMITS } from "@zcode/shared";
import type {
  IConversationShareService,
  ImportConversationShareInput,
  ImportConversationShareResult,
} from "@zcode/services";

/** 文件字节只进入用户已选择的 Host，底层传输不增加交互步骤。 */
export async function importConversationArchive(
  service: Pick<
    IConversationShareService,
    "beginArchiveImport" | "appendArchiveImport" | "releaseArchiveImport" | "importShare"
  >,
  data: ArrayBuffer,
  input: Omit<ImportConversationShareInput, "archiveId">,
  operationId: string,
): Promise<ImportConversationShareResult> {
  if (!data.byteLength || data.byteLength > CONVERSATION_ARCHIVE_LIMITS.archiveBytes) {
    throw Object.assign(new Error("Conversation file exceeds the import limit"), {
      kind: "limit_exceeded",
    });
  }
  const archiveId = await service.beginArchiveImport(data.byteLength);
  try {
    const bytes = new Uint8Array(data);
    for (let offset = 0; offset < bytes.length; offset += CONVERSATION_ARCHIVE_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CONVERSATION_ARCHIVE_CHUNK_BYTES);
      let binary = "";
      for (let start = 0; start < chunk.length; start += 8192) {
        binary += String.fromCharCode(...chunk.subarray(start, start + 8192));
      }
      await service.appendArchiveImport(archiveId, offset, btoa(binary));
    }
    return await service.importShare({ ...input, archiveId }, operationId);
  } finally {
    await service.releaseArchiveImport(archiveId).catch(() => undefined);
  }
}
