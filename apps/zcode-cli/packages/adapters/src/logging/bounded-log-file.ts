import { appendFile, rename, rm, stat } from "node:fs/promises";
import { withFileLock } from "@zcode/shared/node";

const MAX_SEGMENT_BYTES = 10 * 1024 * 1024;
const MAX_SEGMENTS = 4;

/** 多 CLI 共享按日文件：锁内轮转，最多 4 段；到总容量后优先丢弃 debug。 */
export async function appendBoundedDiagnosticLine(
  filePath: string,
  line: string,
  debug: boolean,
  options: { maxSegmentBytes?: number; maxSegments?: number } = {},
): Promise<void> {
  const maxBytes = options.maxSegmentBytes ?? MAX_SEGMENT_BYTES;
  const maxSegments = options.maxSegments ?? MAX_SEGMENTS;
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > maxBytes) return;
  const segment = (index: number) => filePath.replace(/\.jsonl$/, `.${index}.jsonl`);
  await withFileLock(
    filePath,
    async () => {
      const size = await fileSize(filePath);
      if (size + bytes > maxBytes) {
        if (debug && (await fileSize(segment(maxSegments - 1))) > 0) return;
        await rm(segment(maxSegments - 1), { force: true });
        for (let index = maxSegments - 2; index >= 0; index -= 1) {
          const source = index === 0 ? filePath : segment(index);
          try {
            await rename(source, segment(index + 1));
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
      }
      await appendFile(filePath, line, { encoding: "utf8", mode: 0o600 });
    },
    { lockMaxWaitMs: 100, lockRetryDelaysMs: [5, 10, 20] },
  );
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
