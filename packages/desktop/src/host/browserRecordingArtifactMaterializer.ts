import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { IRemoteBackend } from "@zcode/server/remote";
import type { BrowserRecordingArtifact } from "@zcode/shared";

function resolveWorkspaceRecordingPath(workspacePath: string, outputPath: string): string {
  const root = resolve(workspacePath);
  const target = resolve(root, outputPath);
  const relation = relative(root, target);
  if (!relation || relation.startsWith("..") || resolve(root, relation) !== target) {
    throw new Error("recording outputPath must stay inside the workspace");
  }
  if (!target.toLowerCase().endsWith(".webm")) {
    throw new Error("recording outputPath must end with .webm");
  }
  return target;
}

/**
 * main 只返回短期 WebM；Host 按当前 workspace authority 落盘。本地使用同目录 rename，远端
 * 复用已有 backend.upload，避免让远端 Agent 依赖 Desktop 临时路径。
 */
export async function materializeBrowserRecordingArtifact(input: {
  artifact: BrowserRecordingArtifact;
  localPath: string;
  outputPath: string;
  workspacePath: string;
  remoteSessionId?: string;
  remoteBackend?: Pick<IRemoteBackend, "upload">;
}): Promise<BrowserRecordingArtifact> {
  if (input.remoteSessionId) {
    if (!input.remoteBackend) {
      throw new Error("remote Browser recording materialization is unavailable for this session");
    }
    const normalizedWorkspace = posix.normalize(input.workspacePath.replace(/\\/gu, "/"));
    const rawOutputSegments = input.outputPath.split(/[\\/]+/u);
    const normalizedOutput = posix.normalize(input.outputPath.replace(/\\/gu, "/"));
    if (
      rawOutputSegments.some((segment) => segment === ".." || segment === "." || !segment) ||
      normalizedOutput === ".." ||
      normalizedOutput.startsWith("../") ||
      posix.isAbsolute(normalizedOutput)
    ) {
      throw new Error("recording outputPath must stay inside the remote workspace");
    }
    if (!normalizedOutput.toLowerCase().endsWith(".webm")) {
      throw new Error("recording outputPath must end with .webm");
    }
    const remoteTargetPath = posix.join(normalizedWorkspace, normalizedOutput);
    await input.remoteBackend.upload(input.localPath, remoteTargetPath);
    return { ...input.artifact, path: remoteTargetPath };
  }

  const targetPath = resolveWorkspaceRecordingPath(input.workspacePath, input.outputPath);
  await mkdir(dirname(targetPath), { recursive: true });
  const stagingPath = `${targetPath}.zcodium-recording-${randomUUID()}.tmp`;
  try {
    await copyFile(input.localPath, stagingPath);
    // Windows 不能用 rename 原子覆盖已有文件；先移除明确的目标 WebM，再提交 staging 文件。
    await rm(targetPath, { force: true });
    await rename(stagingPath, targetPath);
  } finally {
    await rm(stagingPath, { force: true }).catch(() => undefined);
  }
  return { ...input.artifact, path: targetPath };
}
