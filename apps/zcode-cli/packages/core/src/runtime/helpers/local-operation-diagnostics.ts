import type { Logger } from "@zcode/contracts";

type LocalOperation =
  | "goal_completion_verification"
  | "goal_title_generation"
  | "session_title_generation"
  | "workspace_generate_text";

/** 独立操作不再创建远端 span；固定阶段和耗时仍供本地性能排障使用。 */
export async function observeLocalOperation<T>(
  logger: Logger | undefined,
  operation: LocalOperation,
  execute: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const startedAt = performance.now();
  let status: "completed" | "failed" | "cancelled" = "completed";
  try {
    return await execute();
  } catch (error) {
    status =
      signal?.aborted || (error instanceof Error && error.name === "AbortError")
        ? "cancelled"
        : "failed";
    throw error;
  } finally {
    try {
      logger?.info("Local operation completed", {
        event: "runtime.operation.completed",
        operation,
        durationMs: performance.now() - startedAt,
        status,
      });
    } catch {
      // 观察旁路失败不得覆盖业务结果或原错误。
    }
  }
}
