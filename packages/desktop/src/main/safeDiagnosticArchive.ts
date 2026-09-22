import { readdir, lstat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { DiagnosticRecordSchema, safeLogArgs } from "@zcode/shared";
const levels = new Set(["debug", "info", "warn", "error", "DEBUG", "INFO", "WARN", "ERROR"]);
/** 只读新版本JSONL，不跟随软链；旧日志、模型IO与dump永远不会成为归档候选。 */
export async function readSafeDiagnosticArchive(directories: readonly string[]): Promise<string> {
  const lines: string[] = [];
  let budget = 10 * 1024 * 1024;
  for (const directory of directories) {
    const directoryStat = await lstat(directory).catch(() => null);
    if (!directoryStat?.isDirectory()) continue;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.slice(0, 200)) {
      if (!entry.isFile() || !/\.(?:jsonl|log)$/.test(entry.name)) continue;
      const path = join(directory, entry.name);
      const stats = await lstat(path).catch(() => null);
      if (!stats?.isFile() || stats.size > 17 * 1024 * 1024) continue;
      const input = createReadStream(path, { encoding: "utf8" });
      const reader = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of reader) {
          if (line.length > 256 * 1024) continue;
          let raw: unknown;
          try {
            raw = JSON.parse(line);
          } catch {
            continue;
          }
          if (!raw || typeof raw !== "object") continue;
          const value = raw as Record<string, unknown>;
          if (value.version !== 1 || !levels.has(String(value.level)) || !Array.isArray(value.args))
            continue;
          const diagnostic = DiagnosticRecordSchema.safeParse(value.diagnostic);
          const timestamp =
            typeof value.timestamp === "string" &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.timestamp) &&
            Number.isFinite(Date.parse(value.timestamp))
              ? value.timestamp
              : undefined;
          const component = [
            "main",
            "host",
            "scheduler",
            "renderer",
            "agent",
            "mcp",
            "tool",
            "server",
          ].includes(String(value.component))
            ? value.component
            : undefined;
          const traceId =
            typeof value.traceId === "string" && /^[a-f0-9]{32}$/.test(value.traceId)
              ? value.traceId
              : undefined;
          const sequence =
            typeof value.sequence === "number" &&
            Number.isSafeInteger(value.sequence) &&
            value.sequence >= 0
              ? value.sequence
              : undefined;
          const safe = JSON.stringify({
            version: 1,
            timestamp,
            component,
            traceId,
            sequence,
            level: String(value.level).toLowerCase(),
            args: safeLogArgs(value.args),
            ...(diagnostic.success ? { diagnostic: diagnostic.data } : {}),
          });
          budget -= Buffer.byteLength(safe) + 1;
          if (budget < 0) return lines.join("\n") + "\n";
          lines.push(safe);
        }
      } finally {
        reader.close();
        input.destroy();
      }
    }
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}
