import type { Dirent } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "@zcode/contracts";

export const LOG_RETENTION_DAYS = 7;
export const LOG_CLEANUP_STARTUP_DELAY_MS = 60_000;

const LOG_FILE_NAME_PATTERN = /^zcode-(\d{4})-(\d{2})-(\d{2})(?:\.[1-3])?\.jsonl$/;
const MIN_RETENTION_DAYS = 1;

export interface LogRetentionCleanupOptions {
  logDir: string;
  logger?: Logger;
  now?: Date;
  retentionDays?: number;
}

export interface LogRetentionCleanupResult {
  cutoffDate: string;
  deletedFiles: string[];
  failedFiles: string[];
  retentionDays: number;
  scannedFiles: number;
  status: "completed" | "failed";
}

export interface LogRetentionTimer {
  unref?(): void;
}

export interface LogRetentionScheduleOptions extends Omit<LogRetentionCleanupOptions, "now"> {
  delayMs?: number;
  now?: () => Date;
  setTimeout?: (callback: () => void, delayMs: number) => LogRetentionTimer;
}

export async function cleanupLogRetention(
  options: LogRetentionCleanupOptions,
): Promise<LogRetentionCleanupResult> {
  const retentionDays = normalizeRetentionDays(options.retentionDays);
  const cutoffDate = getCutoffDate(options.now ?? new Date(), retentionDays);
  const result: LogRetentionCleanupResult = {
    cutoffDate,
    deletedFiles: [],
    failedFiles: [],
    retentionDays,
    scannedFiles: 0,
    status: "completed",
  };

  let entries: Dirent[];
  try {
    entries = await readdir(options.logDir, { withFileTypes: true });
  } catch (error) {
    if (hasFileSystemCode(error, "ENOENT")) {
      return result;
    }
    result.status = "failed";
    warnCleanupFailed(options, result, error);
    return result;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const logDate = parseLogFileDate(entry.name);
    if (!logDate) continue;

    result.scannedFiles += 1;
    if (logDate >= cutoffDate) continue;

    try {
      await unlink(join(options.logDir, entry.name));
      result.deletedFiles.push(entry.name);
    } catch (error) {
      if (hasFileSystemCode(error, "ENOENT")) continue;
      result.failedFiles.push(entry.name);
      result.status = "failed";
      warnDeleteFailed(options, result, entry.name, error);
    }
  }

  options.logger?.debug("Log retention cleanup completed", {
    cutoffDate,
    deletedFileCount: result.deletedFiles.length,
    event: "log.retention.cleanup.completed",
    failedFileCount: result.failedFiles.length,
    logDir: options.logDir,
    module: "adapters.logging",
    retentionDays,
    scannedFiles: result.scannedFiles,
    status: result.status,
  });
  return result;
}

export function scheduleLogRetentionCleanup(
  options: LogRetentionScheduleOptions,
): LogRetentionTimer {
  const delayMs = options.delayMs ?? LOG_CLEANUP_STARTUP_DELAY_MS;
  const retentionDays = normalizeRetentionDays(options.retentionDays);
  options.logger?.info("Log retention cleanup scheduled", {
    delayMs,
    event: "log.retention.cleanup.scheduled",
    logDir: options.logDir,
    module: "adapters.logging",
    retentionDays,
    status: "waiting",
  });
  const scheduleTimer =
    options.setTimeout ??
    ((callback: () => void, timeoutMs: number) => setTimeout(callback, timeoutMs));
  const timer = scheduleTimer(() => {
    void cleanupLogRetention({
      logDir: options.logDir,
      logger: options.logger,
      now: options.now?.() ?? new Date(),
      retentionDays,
    });
  }, delayMs);
  timer.unref?.();
  return timer;
}

export function formatLocalLogDate(date: Date): string {
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-");
}

function getCutoffDate(now: Date, retentionDays: number): string {
  return formatLocalLogDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - retentionDays + 1),
  );
}

function normalizeRetentionDays(retentionDays: number | undefined): number {
  if (retentionDays === undefined || !Number.isFinite(retentionDays)) return LOG_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.trunc(retentionDays));
}

function parseLogFileDate(fileName: string): string | undefined {
  const match = LOG_FILE_NAME_PATTERN.exec(fileName);
  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day));
  const formatted = formatLocalLogDate(parsed);
  return formatted === `${year}-${month}-${day}` ? formatted : undefined;
}

function warnCleanupFailed(
  options: LogRetentionCleanupOptions,
  result: LogRetentionCleanupResult,
  error: unknown,
): void {
  options.logger?.warn("Log retention cleanup failed", {
    cutoffDate: result.cutoffDate,
    error: summarizeError(error),
    event: "log.retention.cleanup.failed",
    logDir: options.logDir,
    module: "adapters.logging",
    retentionDays: result.retentionDays,
    status: "failed",
  });
}

function warnDeleteFailed(
  options: LogRetentionCleanupOptions,
  result: LogRetentionCleanupResult,
  fileName: string,
  error: unknown,
): void {
  options.logger?.warn("Log retention file delete failed", {
    cutoffDate: result.cutoffDate,
    error: summarizeError(error),
    event: "log.retention.delete.failed",
    fileName,
    logDir: options.logDir,
    module: "adapters.logging",
    retentionDays: result.retentionDays,
    status: "failed",
  });
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      code,
      message: error.message,
      name: error.name,
    };
  }
  return {
    message: String(error),
    name: "UnknownError",
  };
}

function hasFileSystemCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
