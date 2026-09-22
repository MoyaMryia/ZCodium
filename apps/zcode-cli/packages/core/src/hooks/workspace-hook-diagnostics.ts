import type { Logger, WorkspaceHookReasonCode } from "@zcode/contracts";

export type WorkspaceHookDiagnosticsEvent =
  | "workspace_hook.feature_disabled"
  | "workspace_hook.review_request_created"
  | "workspace_hook.trust_selected"
  | "workspace_hook.review_timeout"
  | "workspace_hook.review_superseded"
  | "workspace_hook.snapshot_mismatch"
  | "workspace_hook.policy_blocked"
  | "workspace_hook.trust_store_failure"
  | "workspace_hook.toggle_failure"
  | "workspace_hook.config_rebuild_failure"
  // revoke 需要专门观测：排查「撤销后面板失效」时，必须能从日志判断
  // 撤销是否成功、并区分随后的失败属于撤销还是授权，否则定位缓慢。
  | "workspace_hook.revoked"
  | "workspace_hook.stale_response";

export interface WorkspaceHookDiagnosticsFields {
  reasonCode?: WorkspaceHookReasonCode;
  source?: string;
  action?: string;
  generation?: number;
  /**
   * Trust 落盘条数诊断：store 写入少于已选择声明时，decisionAccepted
   * 未抛错），日志无从判断是 request 少带了 item 还是写入阶段丢了记录。
   *
   * requestItemCount / requestEnabledCount 记录审核请求实际携带的条数；
   * grantedRecordCount 记录本次真正写入的条数。三者对不上即为静默丢失。
   */
  requestItemCount?: number;
  requestEnabledCount?: number;
  grantedRecordCount?: number;
  /** revoke 实际撤销的声明条数（与 grantedRecordCount 分开，避免语义混用）。 */
  revokedCount?: number;
}

/**
 * Workspace Hook 的观测统一复用现有 Logger Port。
 * 只发送稳定 reason、generation 和摘要，不发送命令、脚本内容、路径或 Trust payload。
 */
export function emitWorkspaceHookDiagnostics(
  logger: Logger | undefined,
  event: WorkspaceHookDiagnosticsEvent,
  fields: WorkspaceHookDiagnosticsFields = {},
): void {
  if (!logger) return;
  logger.info("Workspace Hook Trust diagnostics", {
    event,
    module: "workspace_hook_trust",
    ...(fields.reasonCode ? { reasonCode: fields.reasonCode } : {}),
    ...(fields.source ? { source: fields.source } : {}),
    ...(fields.action ? { action: fields.action } : {}),
    ...(fields.generation === undefined ? {} : { generation: fields.generation }),
    ...(fields.requestItemCount === undefined ? {} : { requestItemCount: fields.requestItemCount }),
    ...(fields.requestEnabledCount === undefined
      ? {}
      : { requestEnabledCount: fields.requestEnabledCount }),
    ...(fields.grantedRecordCount === undefined
      ? {}
      : { grantedRecordCount: fields.grantedRecordCount }),
    ...(fields.revokedCount === undefined ? {} : { revokedCount: fields.revokedCount }),
  });
}
