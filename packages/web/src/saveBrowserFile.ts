import {
  CONVERSATION_ARCHIVE_LIMITS,
  type SaveFileRequest,
  type SaveFileResult,
} from "@zcode/shared";

/** 浏览器没有磁盘保存回执，只能确认下载请求已经交给浏览器。 */
export async function saveBrowserFile(request: SaveFileRequest): Promise<SaveFileResult> {
  let objectUrl: string | undefined;
  let source: string;
  if (request.data) {
    if (
      !request.data.byteLength ||
      request.data.byteLength > CONVERSATION_ARCHIVE_LIMITS.archiveBytes
    )
      return { success: false, error: "invalid_file_payload" };
    source = objectUrl = URL.createObjectURL(
      new Blob([request.data], { type: "application/octet-stream" }),
    );
  } else {
    try {
      const url = new URL(request.sourceUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
        return { success: false, error: "invalid_file_payload" };
      source = url.href;
    } catch {
      return { success: false, error: "invalid_file_payload" };
    }
  }
  const link = document.createElement("a");
  link.href = source;
  link.download = request.suggestedName;
  link.hidden = true;
  if (!objectUrl) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  try {
    document.body.append(link);
    link.click();
    return { success: true, downloadStarted: true, name: request.suggestedName };
  } finally {
    link.remove();
    // 浏览器消费 object URL 是异步的；点击后立即撤销可能得到空文件。
    if (objectUrl) {
      const url = objectUrl;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}
