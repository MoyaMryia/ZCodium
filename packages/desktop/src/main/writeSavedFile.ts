import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 同目录 staging 保证原子替换；写入失败不能截断用户已有文件。 */
export async function writeSavedFile(path: string, data: Uint8Array): Promise<void> {
  const staging = await mkdtemp(join(dirname(path), ".zcodium-save-"));
  try {
    const temporary = join(staging, "file");
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
  } finally {
    // rename 已成功时，清理失败不能把已保存的文件回报成失败。
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
