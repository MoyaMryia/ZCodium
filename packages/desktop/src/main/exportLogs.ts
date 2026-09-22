import { mkdir, mkdtemp, stat, writeFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { getAppConfigDir, getExportLogDir, getFeedbackLogArchiveDir } from "@zcode/services/node";
import { ZCODE_VERSION } from "@zcode/shared";
import { readSafeDiagnosticArchive } from "./safeDiagnosticArchive.js";
import { logger, flushDesktopLogs } from "./logger.js";

async function archiveContents(sourceDir: string): Promise<string> {
  // 异步日志队列先落盘，用户导出才包含触发导出前的完整技术事件。
  await flushDesktopLogs();
  return readSafeDiagnosticArchive([
    join(sourceDir, "logs", "diagnostics-v1"),
    join(homedir(), ".zcode", "cli", "log", "diagnostics-v1"),
  ]);
}
async function writeZip(path: string, content: string): Promise<void> {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(content), "diagnostics.jsonl");
  zip.addBuffer(
    Buffer.from(JSON.stringify({ version: 1, appVersion: ZCODE_VERSION })),
    "manifest.json",
  );
  const completion = pipeline(zip.outputStream, createWriteStream(path));
  zip.end();
  await completion;
}
interface ExportLogsDependencies {
  now?: () => Date;
  getZCodeDataDir?: () => string;
  getExportLogDir?: () => string;
  showItemInFolder?: (path: string) => Promise<void> | void;
}
/** 用户主动导出只打包经过安全边界的新日志；历史raw日志、配置、路径和dump不读取。 */
export async function exportLogs(
  dependencies: ExportLogsDependencies = {},
): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const outputRoot = dependencies.getExportLogDir?.() ?? getExportLogDir();
    await mkdir(outputRoot, { recursive: true });
    const output = await mkdtemp(join(outputRoot, "zcodium-diagnostics-"));
    const path = join(output, "diagnostics.zip");
    const content = await archiveContents(dependencies.getZCodeDataDir?.() ?? getAppConfigDir());
    let result = path;
    try {
      await writeZip(path, content);
    } catch {
      // ZIP写入失败仍提供同一份安全JSONL，不能回退收集旧日志或原始文件。
      await rm(path, { force: true }).catch(() => {});
      result = join(output, "diagnostics.jsonl");
      await writeFile(result, content, "utf8");
    }
    const show =
      dependencies.showItemInFolder ??
      (async (target: string) => {
        const { shell } = await import("electron");
        shell.showItemInFolder(target);
      });
    await show(result);
    logger.info("[diagnostics] archive created");
    return { success: true, path: result };
  } catch {
    logger.warn("[diagnostics] archive failed");
    return { success: false, error: "Diagnostic archive could not be created" };
  }
}
export async function createFeedbackLogArchiveFromExportLogs(
  sourceDir: string,
  options: {
    now?: () => Date;
    outputRootDir?: string;
    stageRootDir?: string;
    onProgress?: (event: { processedBytes: number; totalBytes: number }) => void;
  } = {},
): Promise<{ path: string; size: number }> {
  const outputRoot = options.outputRootDir ?? getFeedbackLogArchiveDir();
  await mkdir(outputRoot, { recursive: true });
  const output = await mkdtemp(join(outputRoot, "safe-diagnostics-"));
  const path = join(output, "diagnostics.zip");
  await writeZip(path, await archiveContents(sourceDir));
  const size = (await stat(path)).size;
  options.onProgress?.({ processedBytes: size, totalBytes: size });
  return { path, size };
}
