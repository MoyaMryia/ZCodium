import { recordUiDiagnostic as emit, type UiDiagnosticEvent } from "@/lib/diagnostics/recorder.js";

const SESSION_OPEN_GROUP = "ui_perf";
const SESSION_OPEN_EVENT_START = "perf_ui_session_open_start";
const SESSION_OPEN_EVENT_RESULT = "perf_ui_session_open_result";

export type SessionOpenKind = "cold" | "warm" | "keep_warm";
export type SessionOpenTrigger =
  | "sidebar"
  | "search"
  | "deeplink"
  | "reload"
  | "subagent"
  | "selection"
  | "split"
  | "pane";
type SessionOpenStatus = "success" | "failed" | "timeout";
type SessionOpenProcessState = "spawned" | "reused";
type SessionOpenRuntimeState = "cold" | "warm";

export interface SessionOpenIdentity {
  sessionOpenId: string;
  sessionId: string;
  openTrigger: SessionOpenTrigger;
  openKind: SessionOpenKind;
  clientMode: "desktop-continuous";
}

interface SessionOpenTimingFields {
  rendererPrepareMs?: number;
  hostPrepareMs?: number;
  taskMetaReadMs?: number;
  cliRequestMs?: number;
  cliBootstrapMs?: number;
  cliSessionRestoreMs?: number;
  initialFrameEncodeMs?: number;
  initialFrameTransportMs?: number;
  rendererSnapshotApplyMs?: number;
  reactRenderMs?: number;
  paintToInteractiveMs?: number;
}

interface SessionOpenResultFields extends SessionOpenTimingFields {
  status: SessionOpenStatus;
  totalMs: number;
  errorPhase?: string;
  errorCode?: string;
  cliProcessState?: SessionOpenProcessState;
  sessionRuntimeState?: SessionOpenRuntimeState;
  attemptCount?: number;
  persistedMessageCount?: number;
  snapshotRowCount?: number;
  snapshotBytes?: number;
  pluginCount?: number;
  skillCount?: number;
  mcpServerCount?: number;
  mcpPendingAtInteractive?: boolean;
}

function roundedNonNegative(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function positiveOrZeroInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value);
}

function identityProperties(identity: SessionOpenIdentity): Record<string, string> {
  return {
    open_trigger: identity.openTrigger,
    open_kind: identity.openKind,
    client_mode: identity.clientMode,
  };
}

function buildSessionOpenStartDiagnostic(identity: SessionOpenIdentity): UiDiagnosticEvent {
  return {
    name: SESSION_OPEN_EVENT_START,
    group: SESSION_OPEN_GROUP,
    value: 1,
    properties: identityProperties(identity),
  };
}

function buildSessionOpenResultDiagnostic(
  identity: SessionOpenIdentity & SessionOpenResultFields,
): UiDiagnosticEvent {
  const properties: Record<string, string | number | boolean | undefined> = {
    ...identityProperties(identity),
    status: identity.status,
    total_ms: roundedNonNegative(identity.totalMs),
    renderer_prepare_ms: roundedNonNegative(identity.rendererPrepareMs),
    host_prepare_ms: roundedNonNegative(identity.hostPrepareMs),
    task_meta_read_ms: roundedNonNegative(identity.taskMetaReadMs),
    cli_request_ms: roundedNonNegative(identity.cliRequestMs),
    cli_bootstrap_ms: roundedNonNegative(identity.cliBootstrapMs),
    cli_session_restore_ms: roundedNonNegative(identity.cliSessionRestoreMs),
    initial_frame_encode_ms: roundedNonNegative(identity.initialFrameEncodeMs),
    initial_frame_transport_ms: roundedNonNegative(identity.initialFrameTransportMs),
    renderer_snapshot_apply_ms: roundedNonNegative(identity.rendererSnapshotApplyMs),
    react_render_ms: roundedNonNegative(identity.reactRenderMs),
    paint_to_interactive_ms: roundedNonNegative(identity.paintToInteractiveMs),
    cli_process_state: identity.cliProcessState,
    session_runtime_state: identity.sessionRuntimeState,
    attempt_count: positiveOrZeroInteger(identity.attemptCount),
    persisted_message_count: positiveOrZeroInteger(identity.persistedMessageCount),
    snapshot_row_count: positiveOrZeroInteger(identity.snapshotRowCount),
    snapshot_bytes: positiveOrZeroInteger(identity.snapshotBytes),
    plugin_count: positiveOrZeroInteger(identity.pluginCount),
    skill_count: positiveOrZeroInteger(identity.skillCount),
    mcp_server_count: positiveOrZeroInteger(identity.mcpServerCount),
    mcp_pending_at_interactive: identity.mcpPendingAtInteractive,
  };
  return {
    name: SESSION_OPEN_EVENT_RESULT,
    group: SESSION_OPEN_GROUP,
    value: roundedNonNegative(identity.totalMs) ?? 0,
    properties,
  };
}

export function reportSessionOpenStart(identity: SessionOpenIdentity): void {
  emit(buildSessionOpenStartDiagnostic(identity));
}

export function reportSessionOpenResult(
  identity: SessionOpenIdentity & SessionOpenResultFields,
): void {
  emit(buildSessionOpenResultDiagnostic(identity));
}
