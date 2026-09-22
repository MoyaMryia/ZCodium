import { safeLogArgs } from "@zcode/shared";
import { stat } from "node:fs/promises";
import { posix } from "node:path";

const SSH_UPLOAD_PROGRESS_INTERVAL_MS = 1_000;
const SSH_UPLOAD_PROGRESS_PERCENT_STEP = 5;

export type SSHUploadTransport = "sftp" | "exec";

const SSH_SFTP_STATUS_LABELS: Record<number, string> = {
  0: "OK",
  1: "EOF",
  2: "NO_SUCH_FILE",
  3: "PERMISSION_DENIED",
  4: "FAILURE",
  5: "BAD_MESSAGE",
  6: "NO_CONNECTION",
  7: "CONNECTION_LOST",
  8: "OP_UNSUPPORTED",
};

function bytesToMB(bytes: number): number {
  return bytes / (1024 * 1024);
}

export async function readLocalFileSize(localPath: string): Promise<number | null> {
  try {
    const fileStat = await stat(localPath);
    return fileStat.isFile() ? fileStat.size : null;
  } catch {
    return null;
  }
}

export function formatSSHUploadLabel(remotePath: string): string {
  return posix.basename(remotePath);
}

export function formatSSHUploadError(error: unknown): string {
  if (error instanceof Error) {
    const sshError = error as Error & { code?: unknown; message?: string };
    if (typeof sshError.code === "number") {
      const codeLabel = SSH_SFTP_STATUS_LABELS[sshError.code] ?? "UNKNOWN";
      return `${codeLabel}(code=${sshError.code})`;
    }

    if (sshError.message) {
      return sshError.message;
    }
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createSSHUploadProgressReporter(
  transport: SSHUploadTransport,
  uploadLabel: string,
  totalBytes: number | null,
): (transferredBytes: number, force: boolean) => void {
  const startedAt = Date.now();
  let lastLoggedAt = 0;
  let lastLoggedPercent = 0;
  let lastLoggedTransferredBytes = -1;

  return (transferredBytes: number, force: boolean) => {
    const now = Date.now();
    const elapsedSeconds = Math.max((now - startedAt) / 1_000, 0.001);
    const speedMBPerSecond = bytesToMB(transferredBytes) / elapsedSeconds;
    const transferredMB = bytesToMB(transferredBytes);
    const totalMB = totalBytes != null ? bytesToMB(totalBytes) : null;
    const percent =
      totalBytes != null && totalBytes > 0
        ? Math.min((transferredBytes / totalBytes) * 100, 100)
        : null;

    const byInterval = now - lastLoggedAt >= SSH_UPLOAD_PROGRESS_INTERVAL_MS;
    const byPercent =
      percent != null && percent - lastLoggedPercent >= SSH_UPLOAD_PROGRESS_PERCENT_STEP;
    const reachedEnd = percent != null && percent >= 100;

    if (!force && !byInterval && !byPercent && !reachedEnd) {
      return;
    }
    if (
      force &&
      transferredBytes === lastLoggedTransferredBytes &&
      (percent == null || percent <= lastLoggedPercent)
    ) {
      return;
    }

    // SSH 连接弹窗之前只在 CDN 下载阶段展示“完成度 + 速度”，上传阶段只有静态起始日志。
    // 慢网或大文件时用户无法判断是继续上传还是已经卡死，这里补上节流后的上传进度快照，
    // 同时带上传输方式和目标文件名，用户才能分辨当前是否已经从 SFTP 切到 exec pipe。
    // 仍然保留节流，避免每个 chunk 都刷一整屏日志。
    if (totalMB != null && percent != null) {
      console.log(
        ...safeLogArgs([
          `[ssh] upload progress [${transport}] (${uploadLabel}): ${percent.toFixed(1)}% (${transferredMB.toFixed(1)}/${totalMB.toFixed(1)} MB, ${speedMBPerSecond.toFixed(2)} MB/s)`,
        ]),
      );
    } else {
      console.log(
        ...safeLogArgs([
          `[ssh] upload progress [${transport}] (${uploadLabel}): ${transferredMB.toFixed(1)} MB (total unknown, ${speedMBPerSecond.toFixed(2)} MB/s)`,
        ]),
      );
    }

    lastLoggedAt = now;
    lastLoggedTransferredBytes = transferredBytes;
    if (percent != null) {
      lastLoggedPercent = percent;
    }
  };
}
