import { SessionEventType } from "@zcode/contracts";
import type { WorkspaceHookReviewFlow, WorkspaceHookReviewFlowRegistry } from "@zcode/core";
import type { WorkspaceHookReviewHostPort } from "./workspace-hook-review-types.js";
import type { WorkspaceHookReviewDiagnostics } from "./workspace-hook-review-diagnostics.js";

/**
 * 监管一个 review flow 直到它终结：跟随 supersede 链，并在 timeout 时补齐
 * diagnostics 与 ReviewSettled。
 *
 * 这段逻辑是**唯一** await flow.result 的地方：若无人 await，它的 10 分钟 deadline 到期后会在 registry
 * 内静默 settle 成 timed_out，前端收不到 ReviewSettled、面板继续按 pending 渲染，
 * 之后每次点击都被 registry.validate 判为 workspace_hooks_review_superseded
 * （实测连续 9 次点击全部被拒，且不会自动重开）。
 *
 * 抽成独立模块供 requestReview 与 revoke 后的重开路径共用：任何新开 flow 的入口都必须
 * 交给它监管，否则同样会产生无人看管的孤儿 flow。
 */
export async function superviseWorkspaceHookReviewFlow(input: {
  flow: WorkspaceHookReviewFlow;
  diagnostics: WorkspaceHookReviewDiagnostics;
  host: WorkspaceHookReviewHostPort;
  registry: WorkspaceHookReviewFlowRegistry;
  sessionId: string;
}): Promise<void> {
  let flow = input.flow;
  while (true) {
    const outcome = await flow.result;
    if (outcome.reasonCode === "workspace_hooks_review_superseded") {
      const current = input.registry.getCurrentFlow(input.sessionId);
      if (!current || current === flow) return;
      flow = current;
      continue;
    }
    if (outcome.reasonCode === "workspace_hooks_interaction_timeout") {
      input.diagnostics.timeout(flow.request);
      await input.host.emit({
        type: SessionEventType.WorkspaceHookReviewSettled,
        payload: {
          interactionId: flow.request.interactionId,
          state: "timed_out",
          reasonCode: outcome.reasonCode,
        },
      });
    }
    return;
  }
}
