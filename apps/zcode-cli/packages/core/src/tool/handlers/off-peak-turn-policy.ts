import { CoreErrorType, createCoreError } from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";

// 官方派发链退休前保留轮次隔离，避免子 Agent 恢复绕出本轮模型执行边界。
export function assertNotOffPeakTurn(
  context: ToolExecutionContext,
  toolName: string,
  options?: { hint?: string; recoverable?: boolean },
): void {
  if (!context.offPeakTurn) return;
  const hint = options?.hint ? ` ${options.hint}` : "";
  throw createCoreError(
    CoreErrorType.PermissionDenied,
    `${toolName} is not allowed while running an idle-time task.${hint}`,
    {
      context: {
        toolCallId: context.toolCallId,
        toolName,
      },
      recoverable: options?.recoverable ?? false,
      retryable: false,
    },
  );
}
