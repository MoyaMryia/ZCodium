import type { DiagnosticRecord } from "@zcode/shared";
import type { ZCodeProcessDiagnostic } from "@zcode/shared/process-diagnostic";

export interface RuntimeProcessSpawnEvent {
  /** 进程泳道（如 mcp-status）；缺省为 chat 主泳道。同 cwd、同 command 的多 lane 进程靠它归因。 */
  lane?: string;
  pid: number;
  provider: string;
  workspacePath: string;
  startedAt: number;
  runtimeGeneration: number;
  runtimeInstanceId: string;
}

export interface RuntimeProcessReadyEvent {
  /** 进程泳道（如 mcp-status）；缺省为 chat 主泳道。同 cwd、同 command 的多 lane 进程靠它归因。 */
  lane?: string;
  pid: number;
  provider: string;
  readyAt: number;
  startupDurationMs: number;
  runtimeGeneration: number;
  runtimeInstanceId: string;
}

export interface RuntimeProcessExitEvent {
  /** 进程泳道（如 mcp-status）；缺省为 chat 主泳道。同 cwd、同 command 的多 lane 进程靠它归因。 */
  lane?: string;
  pid: number;
  provider: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  endedAt: number;
  terminationKind: "expected" | "unexpected" | "watchdog_recycle";
  terminationReason?: string;
  runtimeReady: boolean;
  runtimeGeneration: number;
  runtimeInstanceId: string;
  uptimeMs: number;
  stderrLineCount: number;
}

export interface RuntimeProcessErrorEvent {
  /** 进程泳道（如 mcp-status）；缺省为 chat 主泳道。同 cwd、同 command 的多 lane 进程靠它归因。 */
  lane?: string;
  pid: number | null;
  provider: string;
  errorCode?: DiagnosticRecord["errorCode"];
  frames: string[];
  runtimeGeneration: number;
  runtimeInstanceId: string;
  occurredAt: number;
}

export interface RuntimeProcessLifecycleReporter {
  onSpawn(event: RuntimeProcessSpawnEvent): void;
  onReady?(event: RuntimeProcessReadyEvent): void;
  onExit(event: RuntimeProcessExitEvent): void;
  onError?(event: RuntimeProcessErrorEvent): void;
  onException?(event: RuntimeProcessExceptionEvent): void;
}

export interface RuntimeProcessExceptionEvent {
  lane?: string;
  pid: number;
  provider: string;
  runtimeGeneration: number;
  runtimeInstanceId: string;
  diagnostic: ZCodeProcessDiagnostic;
}

export interface RuntimeTaskCountChangedEvent {
  runningTaskCount: number;
}

export interface RuntimeTaskReporter {
  onRunningTaskCountChanged(event: RuntimeTaskCountChangedEvent): void;
}
