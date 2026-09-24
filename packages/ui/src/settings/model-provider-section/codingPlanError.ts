import { CODING_PLAN_SYSTEM_BUSY } from "@zcode/shared";
const CODING_PLAN_OAUTH_REQUIRED_ERROR = "coding_plan_oauth_required";
export function normalizeErrorMessage(error: unknown): string {
  const message = readErrorMessage(error);
  if (isCodingPlanSystemBusyMessage(message)) {
    // 服务接口可能返回 WAF HTML 或 JSON 解析错误。
    // 这类内容不能直接展示给用户，统一提示系统繁忙。
    return CODING_PLAN_SYSTEM_BUSY;
  }
  if (isCodingPlanOAuthRequiredMessage(message)) {
    // 账号查询接口仍依赖 OAuth 登录态。
    // token 过期、损坏或缺失时要引导用户重新登录/连接，不能直接展示后端原始 token 错误。
    return CODING_PLAN_OAUTH_REQUIRED_ERROR;
  }
  return message;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return String(error);
}

function isCodingPlanSystemBusyMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("<!doctype") ||
    /<\s*(html|head|body|script|style|title|meta)\b/.test(normalized) ||
    normalized.includes("errors.aliyun.com") ||
    normalized.includes("request has been blocked") ||
    normalized.includes("unexpected token '<'") ||
    normalized.includes("unexpected end of json input") ||
    normalized.includes("invalid json response")
  );
}

function isCodingPlanOAuthRequiredMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized === "bigmodel_oauth_required" ||
    normalized === "zai_oauth_required" ||
    normalized.includes("oauth_required") ||
    /\b401\b|\b403\b/.test(normalized) ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("token expired") ||
    normalized.includes("expired or incorrect") ||
    normalized.includes("invalid token") ||
    normalized.includes("access token")
  );
}
