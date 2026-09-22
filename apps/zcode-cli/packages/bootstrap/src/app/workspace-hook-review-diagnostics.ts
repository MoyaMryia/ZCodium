import type { Logger, WorkspaceHookReasonCode } from "@zcode/contracts";
import { emitWorkspaceHookDiagnostics, type WorkspaceHookReviewTarget } from "@zcode/core";
import type {
  WorkspaceHookReviewDecision,
  WorkspaceHookReviewRequestPayload,
} from "@zcode/shared/zcode-protocol-v4";

export class WorkspaceHookReviewDiagnostics {
  constructor(private readonly logger?: Logger) {}

  requestCreated(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_request_created", {
      generation: request.generation,
      // Trust 落盘条数诊断：记录 request 与实际 grant 数，识别静默丢失。
      requestItemCount: request.items.length,
      requestEnabledCount: request.items.filter((item) => item.configuredEnabled).length,
    });
  }

  timeout(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_timeout", {
      generation: request.generation,
      reasonCode: "workspace_hooks_interaction_timeout",
    });
  }

  responseRejected(reasonCode: WorkspaceHookReasonCode): void {
    this.emit(
      reasonCode === "workspace_hooks_review_superseded"
        ? "workspace_hook.stale_response"
        : "workspace_hook.snapshot_mismatch",
      { reasonCode },
    );
  }

  decisionAccepted(
    target: WorkspaceHookReviewTarget,
    decision: WorkspaceHookReviewDecision,
    counts?: { grantedRecordCount?: number; requestEnabledCount?: number },
  ): void {
    this.emit("workspace_hook.trust_selected", {
      action: decision.action,
      generation: target.generation,
      // 与 requestEnabledCount 对不上即为静默丢失：decisionAccepted 只在 applyDecision
      // 成功后发出，因此「已接受却少写」无法从既有字段看出。
      ...(counts?.grantedRecordCount === undefined
        ? {}
        : { grantedRecordCount: counts.grantedRecordCount }),
      ...(counts?.requestEnabledCount === undefined
        ? {}
        : { requestEnabledCount: counts.requestEnabledCount }),
    });
  }

  /**
   * revoke 观测：撤销是否成功、撤了几条都需要可见，否则排障时无从判断。
   */
  revoked(revokedCount: number): void {
    this.emit("workspace_hook.revoked", {
      reasonCode: "workspace_hooks_revoked",
      revokedCount,
    });
  }

  trustStoreFailure(): void {
    this.emit("workspace_hook.trust_store_failure", {
      reasonCode: "workspace_hooks_trust_store_corrupt",
    });
  }

  toggleFailure(reasonCode: WorkspaceHookReasonCode): void {
    this.emit(
      reasonCode === "workspace_hooks_snapshot_mismatch"
        ? "workspace_hook.snapshot_mismatch"
        : reasonCode === "workspace_hooks_config_rebuild_failed"
          ? "workspace_hook.config_rebuild_failure"
          : "workspace_hook.toggle_failure",
      { reasonCode },
    );
  }

  superseded(request: WorkspaceHookReviewRequestPayload): void {
    this.emit("workspace_hook.review_superseded", {
      generation: request.generation,
      reasonCode: "workspace_hooks_review_superseded",
    });
  }

  private emit(
    event: Parameters<typeof emitWorkspaceHookDiagnostics>[1],
    fields: Parameters<typeof emitWorkspaceHookDiagnostics>[2],
  ): void {
    emitWorkspaceHookDiagnostics(this.logger, event, {
      ...fields,
    });
  }
}
