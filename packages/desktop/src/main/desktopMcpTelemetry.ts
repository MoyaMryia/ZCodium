import type { ZCodeMcpTelemetryEvent } from "@zcode/shared";
import { recordDesktopDiagnostic } from "./localDiagnosticSink.js";
/** MCP owner 的业务关联不进入记录；这里只输出进程状态与计量。 */
export function recordMcpDiagnostic(event: ZCodeMcpTelemetryEvent): void {
  if (event.kind === "memory") return;
  if (event.kind === "session_startup")
    recordDesktopDiagnostic({
      version: 1,
      name: "runtime",
      component: "mcp",
      status: event.failedCount ? "error" : "ok",
      metrics: { count: event.processCount, errorCount: event.failedCount },
    });
  else
    recordDesktopDiagnostic({
      version: 1,
      name: "runtime",
      component: "mcp",
      status: event.kind === "process_crash" ? "error" : "ok",
      metrics:
        event.kind === "process_crash"
          ? { durationMs: event.uptimeMs, exitCode: event.exitCode ?? undefined }
          : { count: 1 },
    });
}
