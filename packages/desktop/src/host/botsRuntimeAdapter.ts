// BotsRuntimePort 的 host 实现：把 IZCodeTaskService 接成桥接运行时端口。
// 见 .agents/specs/bots-astrbot-bridge.md。
//
// 直接用 task service 的 createTask/sendPrompt/stopGeneration/respondPermission/respondElicitation
// 与 onDynamicStreamEvent，不经过 SessionRealtimePort，也不另建任务状态。

import { basename } from "node:path";
import type { ZCodePermissionResponse, ZCodeStreamEvent } from "@zcode/shared";
import { IZCodeTaskService } from "@zcode/services";
import {
  BOTS_ALL_WORKSPACES,
  getConversationWorkspaceDir,
  type BotsBindingTarget,
  type BotsRepo,
  type BotsRuntimePort,
  type BotsWorkspaceRef,
} from "@zcode/services/node";

export interface CreateBotsRuntimeAdapterOptions {
  zcodeTaskService: IZCodeTaskService;
  repo: BotsRepo;
  clientLabel?: string;
}

export interface BotsRuntimeAdapter extends BotsRuntimePort {
  dispose(): void;
}

function toWorkspaceRef(workspacePath: string): BotsWorkspaceRef {
  return {
    id: workspacePath,
    label: basename(workspacePath) || workspacePath,
    workspacePath,
  };
}

function targetParams(target: BotsBindingTarget): {
  workspacePath: string;
  workspaceIdentity?: string;
} {
  return {
    workspacePath: target.workspacePath,
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
  };
}

export function createBotsRuntimeAdapter(
  options: CreateBotsRuntimeAdapterOptions,
): BotsRuntimeAdapter {
  const listeners = new Set<(event: ZCodeStreamEvent) => void>();
  const taskSubscriptions = new Map<string, { dispose(): void }>();

  const ensureTaskSubscription = (taskId: string): void => {
    if (taskSubscriptions.has(taskId)) {
      return;
    }
    const disposable = options.zcodeTaskService.onDynamicStreamEvent(taskId)((event) => {
      for (const listener of listeners) {
        listener(event);
      }
    });
    taskSubscriptions.set(taskId, { dispose: () => disposable.dispose() });
  };

  return {
    async listWorkspaces(): Promise<BotsWorkspaceRef[]> {
      const config = await options.repo.readConfig();
      const allowed = config.allowedWorkspaces;
      if (allowed.length === 0 || allowed.includes(BOTS_ALL_WORKSPACES)) {
        return [toWorkspaceRef(getConversationWorkspaceDir())];
      }
      return allowed.map(toWorkspaceRef);
    },

    async createSession(input): Promise<{ sessionId: string }> {
      const task = await options.zcodeTaskService.createTask({
        ...targetParams(input.target),
        deferPersistenceUntilFirstPrompt: true,
      });
      ensureTaskSubscription(task.taskId);
      return { sessionId: task.taskId };
    },

    async sendPrompt(input): Promise<{ runId?: string }> {
      ensureTaskSubscription(input.sessionId);
      await options.zcodeTaskService.sendPrompt({
        taskId: input.sessionId,
        traceId: input.traceId,
        content: input.content,
        clientId: `bots:${input.binding.bindingId}`,
        clientLabel: options.clientLabel ?? "AstrBot",
      });
      return {};
    },

    async stopRun(input): Promise<void> {
      await options.zcodeTaskService.stopGeneration({
        taskId: input.sessionId,
        ...targetParams(input.binding.target),
        ...(input.runId ? { runId: input.runId } : {}),
      });
    },

    async respondPermission(input): Promise<void> {
      await options.zcodeTaskService.respondPermission({
        taskId: input.sessionId,
        ...targetParams(input.binding.target),
        ...(input.runId ? { runId: input.runId } : {}),
        requestId: input.requestId,
        optionId: input.optionId,
        response: input.response as ZCodePermissionResponse,
      });
    },

    async respondElicitation(input): Promise<void> {
      await options.zcodeTaskService.respondElicitation({
        taskId: input.sessionId,
        ...targetParams(input.binding.target),
        ...(input.runId ? { runId: input.runId } : {}),
        requestId: input.requestId,
        action: input.action,
        ...(input.content ? { content: input.content } : {}),
      });
    },

    onDidReceiveEvent(listener): { dispose(): void } {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },

    dispose(): void {
      for (const subscription of taskSubscriptions.values()) {
        subscription.dispose();
      }
      taskSubscriptions.clear();
      listeners.clear();
    },
  };
}
