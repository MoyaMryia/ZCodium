/**
 * DeskPilot 错误契约。
 *
 * 设计约束（见 `.agents/specs/desk-pilot.md` 错误码表）：
 * - 错误码跨平台同语义，adapter 不允许发明新码；
 * - `possiblySent` 随错误一起传递，因为"失败了但可能已经点下去了"和"没动"的补救方式不同；
 * - `recovery` 是给模型的下一步建议，必须是可执行的一句话，不允许是"重试"这种空话。
 */

import type { PlatformId, PerceptionSource } from "./ui-map.js";

export const DESK_ERROR_CODES = [
  /** ref 不属于最新 snapshot，或 snapshot 已被回收。 */
  "STALE_REF",
  /** window_id 已不再代表原界面（窗口关闭、被替换、归属变更）。 */
  "SURFACE_REPLACED",
  /** app_ref 的 pid / bundleId / name / windowId 指向不同活界面。 */
  "IDENTITY_CONFLICT",
  /** hit-test 无法证明坐标目标归属请求的应用。 */
  "OWNERSHIP_UNPROVEN",
  /** 平台或当前授权状态下不支持该原语。 */
  "UNSUPPORTED_ON_PLATFORM",
  /** 授权缺失。`request_access` 会说明缺哪一项。 */
  "PERMISSION_DENIED",
  /** daemon 未在期限内响应。 */
  "TOOL_TIMEOUT",
  /** `expect` 谓词未满足。此时动作确实已执行。 */
  "DEVIATION",
  /** 未持 Action Lease。 */
  "LEASE_NOT_HELD",
  /** subagent 没有桌面控制权。 */
  "SUBAGENT_UNAVAILABLE",
  /** daemon 返回了无法解析或超出契约的载荷。 */
  "PROTOCOL_VIOLATION",
  /** 输入参数不合法。 */
  "INVALID_ARGUMENT",
] as const;

export type DeskErrorCode = (typeof DESK_ERROR_CODES)[number];

/** 授权作用域。不同平台只关心其中一部分，其余为 `not_applicable`。 */
export type AccessScope =
  | "accessibility"
  | "screen_recording"
  | "input_monitoring"
  | "automation"
  | "portal_screencast"
  | "portal_remotedesktop";

export type GrantState = "granted" | "denied" | "unknown" | "not_applicable";

export interface AccessReport {
  readonly scope: AccessScope;
  readonly state: GrantState;
  /** 授权状态下给用户的下一步操作；已授权时为 null。 */
  readonly remediation: string | null;
}

/** 原语的可用程度。`degraded` 表示能用但有已知限制，限制写进 `notes`。 */
export type PrimitiveState = "available" | "degraded" | "unavailable";

/**
 * 冻结的能力声明。
 *
 * daemon 启动时上报一次，core 冻结后运行期只读；模型看到的工具表由它裁剪。
 */
export interface CapabilitySet {
  readonly platform: PlatformId;
  /** 会话类型。Wayland 下 `wayland`，X11 下 `x11`，Windows/macOS 为 `native`。 */
  readonly sessionType: "native" | "x11" | "wayland";
  readonly perception: Readonly<Record<PerceptionSource, PrimitiveState>>;
  readonly primitives: {
    readonly pointer: boolean;
    readonly keyboard: boolean;
    /** 不抢焦点的语义动作。 */
    readonly semantic: boolean;
    readonly capture: boolean;
    readonly clipboardRead: boolean;
    readonly windowEnumerate: boolean;
    /** 定向到指定进程的后台输入（macOS `CGEventPostToPid` 一类）。 */
    readonly backgroundInput: boolean;
  };
  readonly grants: Readonly<Record<AccessScope, GrantState>>;
  /** 人类可读的限制说明，会原样进入 `capabilities` 工具的返回。 */
  readonly notes: readonly string[];
}

/** DeskPilot 的唯一错误类型。 */
export class DeskPilotError extends Error {
  readonly code: DeskErrorCode;
  readonly possiblySent: boolean;
  readonly recovery: string | null;

  constructor(options: {
    code: DeskErrorCode;
    message: string;
    possiblySent: boolean;
    recovery?: string | null;
  }) {
    super(options.message);
    this.name = "DeskPilotError";
    this.code = options.code;
    this.possiblySent = options.possiblySent;
    this.recovery = options.recovery ?? null;
  }
}

/** 判断一个未知字符串是否是合法错误码。daemon 返回值必须先过这一关。 */
export function isDeskErrorCode(value: unknown): value is DeskErrorCode {
  return typeof value === "string" && (DESK_ERROR_CODES as readonly string[]).includes(value);
}
