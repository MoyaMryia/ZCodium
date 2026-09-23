// bridge → ZCodium runtime 的控制端口。见 .agents/specs/bots-astrbot-bridge.md。
//
// 由 host 注入具体实现（IZCodeTaskService + SessionRealtimePort）；服务层不 import 具体运行时，
// 也不持有第二套任务状态。

import type { ZCodeStreamEvent } from "@zcode/shared";
import type { BotsBinding, BotsBindingTarget } from "./domain.js";

export interface BotsWorkspaceRef {
  id: string;
  label: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface BotsRuntimePort {
  listWorkspaces(): Promise<BotsWorkspaceRef[]>;

  /** 新建或复用 session；`forceNew` 为 `/new`。 */
  createSession(input: {
    binding: BotsBinding;
    target: BotsBindingTarget;
    forceNew: boolean;
  }): Promise<{ sessionId: string }>;

  /** 发送一次用户输入（一轮）。`traceId` 同时作为 V4 commandId。 */
  sendPrompt(input: {
    binding: BotsBinding;
    sessionId: string;
    traceId: string;
    content: string;
  }): Promise<{ runId?: string }>;

  stopRun(input: { binding: BotsBinding; sessionId: string; runId?: string }): Promise<void>;

  respondPermission(input: {
    binding: BotsBinding;
    sessionId: string;
    runId?: string;
    requestId: string;
    optionId: string;
    /** 运行时权限应答体（ZCodePermissionResponse）。 */
    response: unknown;
  }): Promise<void>;

  respondElicitation(input: {
    binding: BotsBinding;
    sessionId: string;
    runId?: string;
    requestId: string;
    action: "accept" | "decline" | "cancel";
    content?: Record<string, unknown>;
  }): Promise<void>;

  /** 订阅 task 流式事件（host 侧按 taskId 接 `onDynamicStreamEvent`）。 */
  onDidReceiveEvent(listener: (event: ZCodeStreamEvent) => void): { dispose(): void };
}
