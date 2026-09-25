import {
  createDiagnosticSpanId,
  createDiagnosticTraceId,
  DiagnosticMetricSchema,
  DiagnosticRecordSchema,
  type DiagnosticRecord,
  type DiagnosticRecordInput,
} from "@zcode/shared";
import { logger } from "@/logger.js";

/** 兼容已有计算参数；只有下方显式映射的固定技术字段能进入记录。 */
export interface UiDiagnosticEvent {
  name: string;
  group: string;
  value: number;
  properties?: Record<string, string | number | boolean | undefined>;
}
let diagnosticReporter: ((record: DiagnosticRecord) => void) | null = null;
export function setUiDiagnosticReporter(
  reporter: ((record: DiagnosticRecord) => void) | null,
): void {
  diagnosticReporter = reporter;
}
const MAX_RECORDS = 200;
const records: DiagnosticRecord[] = [];
const rendererTraceId = createDiagnosticTraceId();
let sequence = 0;
const metricNames = new Set<string>(DiagnosticMetricSchema.options);
const metricMappings: Record<string, string> = {
  duration_ms: "durationMs",
  total_ms: "durationMs",
  lag_ms: "inputLagMs",
  stall_ms: "eventLoopDelayMs",
  ttft_ms: "firstTokenMs",
  waiting_ms: "waitingMs",
  tool_call_total: "toolCount",
  tool_call_failed: "failedToolCount",
  agent_step_cnt: "modelRequestCount",
  retry_cnt: "retryCount",
  renderer_prepare_ms: "rendererPrepareMs",
  host_prepare_ms: "hostPrepareMs",
  task_meta_read_ms: "taskMetaReadMs",
  cli_request_ms: "cliRequestMs",
  cli_bootstrap_ms: "cliBootstrapMs",
  cli_session_restore_ms: "cliSessionRestoreMs",
  initial_frame_encode_ms: "initialFrameEncodeMs",
  initial_frame_transport_ms: "initialFrameTransportMs",
  renderer_snapshot_apply_ms: "rendererSnapshotApplyMs",
  react_render_ms: "reactRenderMs",
  paint_to_interactive_ms: "paintToInteractiveMs",
  permission_wait_ms: "permissionWaitMs",
  command_run_ms: "commandRunMs",
  first_output_ms: "firstOutputMs",
  no_output_ms: "noOutputMs",
  output_bytes: "outputBytes",
  fs_read_ms: "fsReadMs",
  fs_write_ms: "fsWriteMs",
  patch_match_ms: "patchMatchMs",
  file_count: "fileCount",
  total_bytes: "totalBytes",
  max_file_bytes: "maxFileBytes",
  hunk_count: "hunkCount",
  match_attempts: "matchAttempts",
  exit_code: "exitCode",
  attempt_count: "count",
  snapshot_row_count: "count",
  snapshot_bytes: "bytes",
  retry_delay_ms: "retryDelayMs",
  idle_ms: "idleMs",
  timeout_ms: "windowMs",
  http_status: "statusCode",
  loaf_script_count: "loafScriptCount",
  loaf_top_duration_ms: "loafTopDurationMs",
  loaf_top_share_pct: "loafTopSharePercent",
};
const events: Record<string, Pick<DiagnosticRecordInput, "name" | "stage" | "phase">> = {
  perf_ui_launch_to_input: { name: "startup", stage: "complete", phase: "summary" },
  perf_ui_launch_electron_init_ms: { name: "startup", stage: "prepare" },
  perf_ui_launch_app_ready_ms: { name: "startup", stage: "main" },
  perf_ui_launch_window_ms: { name: "startup", stage: "ready" },
  perf_ui_launch_renderer_load_ms: { name: "startup", stage: "render" },
  perf_ui_launch_react_commit_ms: { name: "startup", stage: "mount" },
  perf_ui_launch_startup_gate_ms: { name: "startup", stage: "input" },
  perf_ui_session_open_start: { name: "session_open", phase: "start" },
  perf_ui_session_open_result: { name: "session_open", phase: "end" },
  perf_ui_first_token: { name: "ui_latency", stage: "first_token" },
  perf_ui_message_complete: { name: "ui_latency", stage: "complete" },
  perf_ui_turn_breakdown: { name: "ui_latency", phase: "summary" },
  perf_ui_tool_call_detail: { name: "tool_execution", stage: "tool" },
  perf_ui_stream_stall: { name: "stream_stall", stage: "stall" },
  perf_ui_input_lag: { name: "ui_latency", stage: "input" },
  ui_chat_error: { name: "error" },
  ui_react_error: { name: "error", stage: "render" },
  ui_model_request: { name: "model_request", stage: "request" },
  ui_long_task: { name: "long_task", stage: "render" },
  ui_operation: { name: "ui.action" },
};
const errorCategories: Record<string, DiagnosticRecord["errorCategory"]> = {
  auth_failed: "auth",
  permission_denied: "permission",
  plan_access_denied: "permission",
  timeout: "timeout",
  stream_idle_timeout: "timeout",
  network_error: "network",
  tls_error: "network",
  cancelled: "cancelled",
  quota_exhausted: "quota",
  balance_insufficient: "quota",
  plan_expired: "quota",
  rate_limited: "quota",
  provider_overloaded: "overload",
  storage_error: "storage",
  invalid_input: "validation",
  invalid_request: "validation",
  model_not_found: "validation",
  provider_not_configured: "validation",
  model_config_missing: "validation",
  server_error: "provider",
  empty_model_response: "provider",
  stream_recovery_discarded: "runtime",
};
export function readUiDiagnostics(): readonly DiagnosticRecord[] {
  return records.map((record) => ({ ...record, metrics: { ...record.metrics } }));
}
export function clearUiDiagnostics(): void {
  records.length = 0;
}
export function recordUiDiagnostic(event: UiDiagnosticEvent): void {
  try {
    const identity = events[event.name];
    if (!identity) return;
    const properties = event.properties ?? {};
    const metrics: Record<string, number> = {};
    if (Number.isFinite(event.value) && event.value >= 0)
      metrics[identity.name === "error" ? "count" : "durationMs"] = Math.round(event.value);
    for (const [source, target] of Object.entries(metricMappings)) {
      const value = properties[source];
      if (metricNames.has(target) && typeof value === "number" && Number.isFinite(value))
        metrics[target] = value;
    }
    const result = properties.status ?? properties.result;
    const status =
      result === "failed" || result === "model_request_failed"
        ? "error"
        : result === "timeout"
          ? "timeout"
          : result === "interrupted" || result === "cancelled"
            ? "cancelled"
            : result === "success" || result === "completed" || result === "model_request_completed"
              ? "ok"
              : undefined;
    const errorCategory =
      identity.name === "error"
        ? (errorCategories[String(properties.failure_reason)] ??
          (properties.error_source === "network" ||
          properties.error_source === "runtime" ||
          properties.error_source === "tool" ||
          properties.error_source === "provider"
            ? properties.error_source
            : "unknown"))
        : undefined;
    const stage =
      event.name === "ui_operation"
        ? properties.stage === "command"
          ? "dispatch"
          : "prepare"
        : identity.name === "session_open" && properties.open_kind === "cold"
          ? "cold"
          : identity.name === "session_open" &&
              (properties.open_kind === "warm" || properties.open_kind === "keep_warm")
            ? "warm"
            : identity.stage;
    const record = DiagnosticRecordSchema.parse({
      ...identity,
      stage,
      component: "renderer",
      status,
      errorCategory,
      metrics,
      traceId: rendererTraceId,
      spanId: createDiagnosticSpanId(),
      sequence: sequence++,
    });
    const production =
      (import.meta as ImportMeta & { env?: { PROD?: boolean } }).env?.PROD === true ||
      (typeof process !== "undefined" && process.env.NODE_ENV === "production");
    if (!production) {
      records.push(record);
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
      if (typeof window !== "undefined")
        (
          window as Window & {
            __ZCODIUM_UI_DIAGNOSTICS__?: {
              read: typeof readUiDiagnostics;
              clear: typeof clearUiDiagnostics;
            };
          }
        ).__ZCODIUM_UI_DIAGNOSTICS__ = { read: readUiDiagnostics, clear: clearUiDiagnostics };
    }
    if (diagnosticReporter) {
      diagnosticReporter(record);
      logger.debug("diagnostic", record);
      return;
    }
    if (record.name === "error") logger.lifecycle.warn("diagnostic", record);
    else if (
      (record.name === "startup" && record.phase === "summary") ||
      (record.name === "session_open" && record.phase === "end")
    )
      logger.lifecycle.info("diagnostic", record);
    else logger.debug("diagnostic", record);
  } catch {
    // 诊断失败不能改变用户命令、渲染或错误恢复的结果。
  }
}
