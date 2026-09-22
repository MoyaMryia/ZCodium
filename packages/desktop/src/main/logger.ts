import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { safeLogArgs, createDiagnosticTraceId } from "@zcode/shared";
import { LOG_RETENTION_DAYS } from "./logRetention.js";
import { getAppConfigDir, maybeThrowInjectedFsFault } from "@zcode/services/node";

type LogLevel = "debug" | "info" | "warn" | "error";
const rawConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
// 开发终端/runner先退出时EPIPE是异步stream事件，不能只靠console调用的try/catch。
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
const traceId = createDiagnosticTraceId();
let sequence = 0;
let pending = 0;
let dropped = 0;
let writes = Promise.resolve();
let prepared = false;
const MAX_PENDING = 512;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const sizes = new Map<string, number>();
function getLogDir(): string {
  const e2e =
    process.env.ZCODE_ENV === "test" ? process.env.ZCODE_E2E_RUNTIME_LOG_DIR?.trim() : undefined;
  return join(e2e ?? join(getAppConfigDir(), "logs"), "diagnostics-v1");
}
async function prepare(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  if (prepared) return;
  prepared = true;
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 86400000;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}(?:\.[1-4])?\.log$/.test(entry.name)) continue;
    const path = join(directory, entry.name);
    const info = await stat(path).catch(() => null);
    if (info && info.mtimeMs < cutoff) await rm(path, { force: true }).catch(() => {});
  }
}
async function append(timestamp: string, line: string): Promise<void> {
  const directory = getLogDir();
  await prepare(directory);
  const day = timestamp.slice(0, 10);
  const path = join(directory, `${day}.log`);
  const bytes = Buffer.byteLength(line);
  const size = sizes.get(path) ?? (await stat(path).catch(() => null))?.size ?? 0;
  if (size + bytes > MAX_FILE_BYTES) {
    await rm(join(directory, `${day}.4.log`), { force: true });
    for (let index = 3; index >= 1; index--)
      await rename(
        join(directory, `${day}.${index}.log`),
        join(directory, `${day}.${index + 1}.log`),
      ).catch(() => {});
    await rename(path, join(directory, `${day}.1.log`)).catch(() => {});
    sizes.set(path, 0);
  } else sizes.set(path, size);
  maybeThrowInjectedFsFault({ operation: "appendFile", path });
  await appendFile(path, line, "utf8");
  sizes.set(path, (sizes.get(path) ?? 0) + bytes);
}
function write(level: LogLevel, component: "main" | "renderer", args: unknown[]): void {
  const safe = safeLogArgs(args);
  const timestamp = new Date().toISOString();
  const entry = {
    version: 1,
    timestamp,
    level,
    component,
    traceId,
    sequence: sequence++,
    args: safe,
  };
  try {
    rawConsole[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      `[${timestamp}] [${level}] [${component}]`,
      ...safe,
    );
  } catch {
    /* closed console cannot break business work */
  }
  if (pending >= MAX_PENDING) {
    dropped++;
    return;
  }
  pending++;
  if (dropped) {
    safe.push({ version: 1, name: "log", component, metrics: { droppedCount: dropped } });
    dropped = 0;
  }
  const line = JSON.stringify(entry) + "\n";
  writes = writes
    .catch(() => {})
    .then(() => append(timestamp, line))
    .catch(() => {})
    .finally(() => {
      pending--;
    });
}
/** 有界异步队列，应用退出等待已接纳本地写入，不阻塞每次业务调用。 */
export function flushDesktopLogs(): Promise<void> {
  return writes;
}
export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.NODE_ENV !== "production") write("debug", "main", args);
  },
  info: (...args: unknown[]) => write("info", "main", args),
  warn: (...args: unknown[]) => write("warn", "main", args),
  error: (...args: unknown[]) => write("error", "main", args),
  fromRenderer: (level: LogLevel, args: unknown[]) => {
    if (level !== "debug" || process.env.NODE_ENV !== "production") write(level, "renderer", args);
  },
};
