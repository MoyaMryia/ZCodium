/**
 * DeskPilot 唯一公开契约。
 *
 * 这个文件是整个包对外的唯一入口（`architecture-policy.yaml` 的 `publicEntrypoints`）。
 * 跨模块只允许从这里导入；数据类型在 `ui-map.ts` / `actuation.ts` / `errors.ts`，
 * 这里只做再导出，避免契约文件膨胀超过 300 行上限。
 *
 * `SurfaceAdapter` 恰好 12 个方法，对应架构策略的 `maxPublicMethods: 12`。
 * 方法按**输入通道**收敛（语义 / 指针 / 文本 / 按键 / 剪贴板），不是一个动词一个方法——
 * 这样新增手势不需要扩端口，只需要扩 `actuation.ts` 里的联合类型。
 */

import type { AccessReport, AccessScope, CapabilitySet } from "./errors.js";
import type {
  ActuationOutcome,
  CdpAttachRequest,
  CdpEndpoint,
  ClipboardOp,
  ClipboardResult,
  KeyChord,
  PointerRequest,
  SemanticRequest,
  TextRequest,
} from "./actuation.js";
import type { ElementHandle, ObserveRequest, SurfaceSummary, UiElement, UiMap } from "./ui-map.js";

export type {
  Bounds,
  ElementFlag,
  ElementHandle,
  ElementKind,
  ElementProvenance,
  FrameBinding,
  ObserveRequest,
  PerceptionSource,
  PlatformId,
  SurfaceRef,
  SurfaceSummary,
  UiElement,
  UiMap,
} from "./ui-map.js";

export type {
  ActionTarget,
  ActuationEnvelope,
  ActuationOutcome,
  CdpAttachRequest,
  CdpEndpoint,
  ClipboardOp,
  ClipboardResult,
  Expectation,
  KeyChord,
  KeyModifier,
  PointerButton,
  PointerGesture,
  PointerRequest,
  SemanticRequest,
  TextOp,
  TextRange,
  TextRequest,
  Verification,
} from "./actuation.js";

export type {
  AccessReport,
  AccessScope,
  CapabilitySet,
  DeskErrorCode,
  GrantState,
  PrimitiveState,
} from "./errors.js";
export { DESK_ERROR_CODES, DeskPilotError, isDeskErrorCode } from "./errors.js";

/**
 * 平台后端端口。
 *
 * 实现者必须遵守：
 * - 参数校验阶段的失败抛 `DeskPilotError` 且 `possiblySent: false`；
 * - 已下达到平台的失败 `possiblySent: true`；
 * - 不支持的原语抛 `UNSUPPORTED_ON_PLATFORM`，不允许静默降级或伪造成功；
 * - 不缓存平台状态，每次调用都取当前值。
 */
export interface SurfaceAdapter {
  /** 启动时调用一次。返回的能力集由 core 冻结。 */
  capabilities(): Promise<CapabilitySet>;

  /** 枚举可操作界面。 */
  surfaces(): Promise<readonly SurfaceSummary[]>;

  /** 观测一个界面，产出 UiMap。 */
  observe(request: ObserveRequest): Promise<UiMap>;

  /** 按句柄读单个元素；句柄过期返回 null，由 core 转成 `STALE_REF`。 */
  inspect(handle: ElementHandle): Promise<UiElement | null>;

  /** 执行元素自报的语义动作。 */
  semantic(request: SemanticRequest): Promise<ActuationOutcome>;

  /** 指针手势：点击 / 拖拽 / 滚动。 */
  pointer(request: PointerRequest): Promise<ActuationOutcome>;

  /** 文本操作：输入 / 直设 / 选择 / 粘贴。 */
  text(request: TextRequest): Promise<ActuationOutcome>;

  /** 全局按键。作用于当前焦点，不指向具体元素。 */
  key(chord: KeyChord): Promise<ActuationOutcome>;

  /** 剪贴板读写。 */
  clipboard(op: ClipboardOp): Promise<ClipboardResult>;

  /** 为 Chromium 系应用打开 DevTools 端口。 */
  attachCdp(request: CdpAttachRequest): Promise<CdpEndpoint>;

  /** 只报告授权状态，不尝试自动提权。 */
  requestAccess(scope: AccessScope): Promise<AccessReport>;

  /** 释放原生资源。幂等。 */
  shutdown(): Promise<void>;
}
