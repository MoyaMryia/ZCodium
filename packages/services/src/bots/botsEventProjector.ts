// TaskStreamMirrorableEvent → bridge delivery 的纯投影。见 .agents/specs/bots-astrbot-bridge.md。
//
// 只做结构化映射，不做 IO、不持有状态；权限/elicitation 返回 interaction 描述，
// 由服务层带 token/selectionId 组装成 selection 载荷。

import type { BotsBridgeDeliveryPayload, ZCodeStreamEvent } from "@zcode/shared";
import type {
  BotsElicitationDescriptor,
  BotsInteractionDescriptor,
  BotsPermissionDescriptor,
} from "./botsInteraction.js";

export type BotsStreamTerminal = "completed" | "failed";

export interface BotsProjectedEvent {
  payload?: BotsBridgeDeliveryPayload;
  terminal?: BotsStreamTerminal;
  interaction?: BotsInteractionDescriptor;
}

function readToolStatus(
  status: string,
): "pending" | "in_progress" | "completed" | "failed" | "denied" {
  switch (status) {
    case "pending":
    case "in_progress":
    case "completed":
    case "failed":
    case "denied":
      return status;
    case "stopped":
      return "failed";
    default:
      return "pending";
  }
}

export function projectTaskStreamEvent(event: ZCodeStreamEvent): BotsProjectedEvent | null {
  switch (event.type) {
    case "agent_message_chunk": {
      // 只投影主 agent 正文；子工具正文由 tool 事件表达。
      if (event.parentToolUseId || !event.content) {
        return null;
      }
      return { payload: { type: "text", text: event.content } };
    }
    case "tool_call":
      return {
        payload: { type: "tool", toolId: event.toolId, title: event.title, status: "pending" },
      };
    case "tool_call_update":
      return {
        payload: {
          type: "tool",
          toolId: event.toolId,
          title: event.title ?? event.toolName ?? event.toolId,
          status: readToolStatus(event.status),
          ...(event.error ? { summary: event.error } : {}),
        },
      };
    case "permission_request": {
      const descriptor: BotsPermissionDescriptor = {
        kind: "permission",
        requestId: event.requestId,
        title: event.title ?? event.description ?? "需要权限",
        ...(event.description ? { description: event.description } : {}),
        options: event.options.map((option) => ({
          optionId: option.optionId,
          label: option.name,
          ...(option.description ? { description: option.description } : {}),
          kind: option.kind,
          response: option.response,
        })),
      };
      return { interaction: descriptor };
    }
    case "elicitation_request": {
      const questions =
        event.questions && event.questions.length > 0
          ? event.questions.map((question, index) => ({
              index,
              question: question.question,
              ...(question.header ? { header: question.header } : {}),
              ...(question.multiSelect ? { multiSelect: question.multiSelect } : {}),
              options: question.options.map((option) => ({
                value: option.value,
                label: option.label,
                ...(option.description ? { description: option.description } : {}),
              })),
            }))
          : [
              {
                index: 0,
                question: event.message,
                ...(event.header ? { header: event.header } : {}),
                ...(event.multiSelect ? { multiSelect: event.multiSelect } : {}),
                options: event.options.map((option) => ({
                  value: option.value,
                  label: option.label,
                  ...(option.description ? { description: option.description } : {}),
                })),
              },
            ];
      const descriptor: BotsElicitationDescriptor = {
        kind: "elicitation",
        requestId: event.requestId,
        questions,
        currentQuestionIndex: event.currentQuestionIndex ?? 0,
      };
      return { interaction: descriptor };
    }
    case "task_complete":
      return { terminal: "completed" };
    case "task_error":
      return {
        terminal: "failed",
        payload: { type: "notice", level: "error", message: event.error },
      };
    default:
      return null;
  }
}
