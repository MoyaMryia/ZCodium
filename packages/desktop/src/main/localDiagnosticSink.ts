import { createDiagnosticsExporter } from "@zcode/shared/node";
import {
  parseDiagnosticRecord,
  type DiagnosticRecord,
  type DiagnosticRecordInput,
} from "@zcode/shared";
import { logger } from "./logger.js";
const exporter = createDiagnosticsExporter();
export const shutdownDesktopDiagnostics = () => exporter.shutdown();
let consumer: ((record: DiagnosticRecord) => void) | undefined;
/** Main owns the optional exporter; Host and Renderer only send local observations. */
export function setDesktopDiagnosticConsumer(
  next: ((record: DiagnosticRecord) => void) | undefined,
): void {
  consumer = next;
}
export function recordDesktopDiagnostic(input: DiagnosticRecordInput): void {
  const record = parseDiagnosticRecord(input);
  if (!record) return;
  // 严格 schema 是日志和标准导出的共同边界，不能把原输入用于错误日志。
  const frequent = [
    "local.ttft",
    "ui.action",
    "ui_latency",
    "input_lag",
    "model_request",
    "tool_execution",
    "stream_stall",
    "long_task",
    "permission",
  ].includes(record.name);
  logger[frequent ? "debug" : "info"]("[diagnostic]", record);
  exporter.record(record);
  try {
    consumer?.(record);
  } catch {
    /* Diagnostics cannot interrupt business work. */
  }
}
