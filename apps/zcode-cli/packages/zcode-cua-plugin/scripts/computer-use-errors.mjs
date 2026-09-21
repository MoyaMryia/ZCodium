/**
 * Computer Use 的统一错误对象与重试策略。
 *
 * 本模块只描述"一次失败的含义"——错误码从哪来、该不该重试、动作有没有可能已经
 * 下发。它不接触 MCP 信封，也不认识 broker；那两部分在
 * {@link ./computer-use-envelope.mjs}。
 */

/**
 * broker 侧错误码到 SDK 错误码的映射。
 *
 * 未登记的码一律落到 INTERNAL：宁可让模型看到一个笼统失败并重新观察，也不能把
 * 一个真实故障静默映射成"成功"。加映射是常态，删条目要看清楚没有别的路径依赖。
 */
export const BROKER_CODE_TO_SDK_CODE = Object.freeze({
  permission_denied: "PERMISSION_DENIED",
  not_authorized: "NOT_AUTHORIZED",
  launch_failed: "LAUNCH_FAILED",
  invalid_request: "INVALID_APP",
  element_unavailable: "ELEMENT_UNAVAILABLE",
  not_settable: "NOT_SETTABLE",
  not_selectable: "NOT_SELECTABLE",
  action_unavailable: "ACTION_UNAVAILABLE",
  foreground_required: "FOREGROUND_REQUIRED",
  controller_busy: "CONTROLLER_BUSY",
  broker_unavailable: "HELPER_UNAVAILABLE",
  version_mismatch: "VERSION_MISMATCH",
  stale_socket: "HELPER_UNAVAILABLE",
  timeout: "TIMEOUT",
  unimplemented: "ACTION_UNAVAILABLE",
  method_not_found: "INTERNAL",
  internal: "INTERNAL",
});

/**
 * 这些码意味着"界面可能已经变了"，重发同一个动作之前必须先重新观察。
 *
 * 注意 STALE_STATE 与 STRUCTURED_STATE_UNAVAILABLE 不由 broker 产生，而是 SDK
 * 自己在解析观察结果时抛出的；把它们列进来是为了让上层只需查一张表。
 */
export const REACQUIRE_FIRST_CODES = Object.freeze([
  "ELEMENT_UNAVAILABLE",
  "STALE_STATE",
  "STRUCTURED_STATE_UNAVAILABLE",
]);

/**
 * 重试也不会改变结果的码。重复发送只会放大副作用（权限弹窗、输入法状态、
 * 已经停用的控制权），所以直接告诉模型放弃。
 */
export const POINTLESS_RETRY_CODES = Object.freeze([
  "CONTROLLER_BUSY",
  "CONTROL_STOPPED",
  "PERMISSION_DENIED",
  "NOT_AUTHORIZED",
  "VERSION_MISMATCH",
  "ACTION_UNAVAILABLE",
  "NOT_SETTABLE",
  "NOT_SELECTABLE",
]);

const REACQUIRE_SET = new Set(REACQUIRE_FIRST_CODES);
const POINTLESS_SET = new Set(POINTLESS_RETRY_CODES);

/**
 * 把「动作是否可能已下发」与错误码折算成一条可执行的重试建议。
 *
 * 优先级是刻意排的：`actionSent` 高于一切。一个可能已经落地的非幂等动作，即使
 * 错误码看起来无害（例如 TIMEOUT），也必须先重新观察——盲重试会把"点了一下"
 * 变成"点了两下"。
 */
export function decideRetryPolicy(actionSent, code) {
  if (actionSent) return "reobserve";
  if (POINTLESS_SET.has(code)) return "never";
  if (REACQUIRE_SET.has(code)) return "reobserve";
  return "retry";
}

/**
 * Computer Use 的失败类型。
 *
 * 与通用 Error 的区别只有一点：它携带**事故信息**。`actionSent` 回答"这次操作
 * 有没有可能已经生效"，`dispatchStatus` 保留 broker 的原话，`details` 带诊断
 * 字段。模型读到 `actionSent: true` 时应当先观察再动作，而不是重发。
 */
export class ComputerUseError extends Error {
  /**
   * @param {string} message 给模型看的、可据此行动的一句话
   * @param {{
   *   code?: string,
   *   actionSent?: boolean,
   *   dispatchStatus?: string,
   *   details?: Record<string, unknown>,
   * }} [init]
   */
  constructor(message, init = {}) {
    super(message);
    this.name = "ComputerUseError";
    this.code = init.code ?? "INTERNAL";
    // 默认 false 是保守方向的**有意选择**：只有 broker 明确报告下发过时才置 true。
    // 反过来（默认 true）会让模型对一个从未发出的动作放弃重试，把可恢复的抖动
    // 变成永久失败。
    this.actionSent = init.actionSent === true;
    if (init.dispatchStatus) this.dispatchStatus = init.dispatchStatus;
    this.details = Object.freeze({ ...init.details });
    this.retry = decideRetryPolicy(this.actionSent, this.code);
  }
}
