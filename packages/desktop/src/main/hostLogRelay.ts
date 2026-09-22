import { safeLogArgs } from "@zcode/shared";
type Level = "info" | "warn" | "error";
interface HostStructuredLog {
  level: Level;
  source: string;
  message?: string;
  args?: unknown[];
}
interface HostLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
interface StructuredEntry extends HostStructuredLog {
  timestamp: string;
}
/** IPC保留结构化安全参数；原stdout只保存净化后的有界记录，不缓存原文。 */
export function createHostLogRelay(
  _label: string,
  logger: HostLogger,
  emitToRenderer?: (entry: StructuredEntry) => void,
) {
  let hasStructured = false;
  const pending: Array<{ level: Level; args: unknown[] }> = [];
  const raw = (level: Level, text: string) => {
    if (hasStructured || pending.length >= 128) return;
    const warning = /^\(node:\d+\)\s+(?:ExperimentalWarning|DeprecationWarning|Warning):/.test(
      text.trimStart(),
    );
    pending.push({ level: warning ? "warn" : level, args: safeLogArgs([text, { stack: text }]) });
  };
  return {
    onStdout: (text: string) => raw("info", text),
    onStderr: (text: string) => raw("error", text),
    onStructuredLog(entry: HostStructuredLog): void {
      hasStructured = true;
      pending.length = 0;
      const args = safeLogArgs(entry.args ?? [entry.message]);
      logger[entry.level]("[host-log]", ...args);
      emitToRenderer?.({
        level: entry.level,
        source: "host",
        args,
        message: JSON.stringify(args),
        timestamp: new Date().toISOString(),
      });
    },
    flushRawLogs(): void {
      if (!hasStructured)
        for (const entry of pending) logger[entry.level]("[host-log]", ...entry.args);
      pending.length = 0;
    },
  };
}
