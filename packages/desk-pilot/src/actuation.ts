/**
 * DeskPilot 执行契约：目标、手势、期望与结果。
 *
 * 设计约束（见 `.agents/specs/desk-pilot.md` D3/D4）：
 * - 目标只有两种：元素 ref（优先）或绑定 frame 的坐标（最后手段）；
 * - 每个破坏性动作都可以带 `Expectation`，动作后由 core 重新观测求值；
 * - `possiblySent` 与 `verification` 是正交的两件事：前者说"可能已经发出去了"，
 *   后者说"我们能不能证明它生效了"。两者都不允许被谎报。
 */

import type { Bounds, SurfaceRef } from "./ui-map.js";

/** 动作目标。坐标目标必须携带 frameId，否则在进入 adapter 前就被拒绝。 */
export type ActionTarget =
  | { readonly kind: "element"; readonly snapshotId: string; readonly ref: string }
  | {
      readonly kind: "coordinate";
      readonly frameId: string;
      readonly x: number;
      readonly y: number;
    };

export type PointerButton = "left" | "right" | "middle";

/** 跨平台修饰键。`cmd` 在非 darwin 上由 core 归一为 `ctrl`，模型无需分辨。 */
export type KeyModifier = "cmd" | "ctrl" | "alt" | "shift" | "win";

export interface KeyChord {
  readonly key: string;
  readonly modifiers: readonly KeyModifier[];
}

/** 指针手势。滚动没有可达性原语，走 raw 时必须让模型知道。 */
export type PointerGesture =
  | {
      readonly kind: "click";
      readonly button: PointerButton;
      readonly clicks: 1 | 2 | 3;
      readonly modifiers?: readonly KeyModifier[];
    }
  | {
      readonly kind: "drag";
      readonly from: Bounds;
      readonly to: Bounds;
      readonly button: PointerButton;
    }
  | {
      readonly kind: "scroll";
      readonly deltaX: number;
      readonly deltaY: number;
    };

export interface TextRange {
  readonly start: number;
  readonly length: number;
}

/** 文本类操作。`set` 只对 `settable` 元素合法，`select` 只对 `selectable` 合法。 */
export type TextOp =
  | { readonly kind: "type"; readonly text: string }
  | { readonly kind: "set"; readonly value: string }
  | { readonly kind: "select"; readonly range: TextRange }
  | { readonly kind: "paste"; readonly text: string };

/** 动作后期望。谓词在动作后由 core 重新观测求值。 */
export type Expectation =
  | { readonly predicate: "element_gone"; readonly target: ActionTarget }
  | { readonly predicate: "element_present"; readonly target: ActionTarget }
  | { readonly predicate: "value_is"; readonly target: ActionTarget; readonly value: string }
  | {
      readonly predicate: "surface_title_is";
      readonly surface: SurfaceRef;
      readonly title: string;
    };

/** 破坏性动作的统一信封。 */
export interface ActuationEnvelope {
  readonly target: ActionTarget;
  readonly expect?: Expectation;
  /** 调用方提供的幂等键。同一键的重复提交由 core 去重，不重复下达平台。 */
  readonly idempotencyKey?: string;
}

/** 语义动作请求：执行元素自报的 action。 */
export interface SemanticRequest extends ActuationEnvelope {
  readonly action: string;
}

/** 指针请求。 */
export interface PointerRequest extends ActuationEnvelope {
  readonly gesture: PointerGesture;
}

/** 文本请求。 */
export interface TextRequest extends ActuationEnvelope {
  readonly op: TextOp;
}

/** 执行结果的三态验证结论。`unverified` 是合法答案，不是失败。 */
export type Verification =
  | { readonly state: "verified"; readonly evidence: string }
  | { readonly state: "deviation"; readonly expected: string; readonly observed: string }
  | { readonly state: "unverified"; readonly reason: string };

/** adapter 执行后的最小回报。 */
export interface ActuationOutcome {
  /** 指令是否已经下达到平台。参数校验失败必须是 false。 */
  readonly possiblySent: boolean;
  readonly verification: Verification;
  /** 动作后产生的 snapshotId；未重新观测时为 null。 */
  readonly snapshotId: string | null;
}

/** 剪贴板操作。Wayland 上读可能不可用，此时 `text` 为 null 且必须说明原因。 */
export type ClipboardOp =
  | { readonly kind: "read" }
  | { readonly kind: "write"; readonly text: string };

export interface ClipboardResult {
  readonly text: string | null;
  readonly written: boolean;
  /** 读不可用或未授权时的原因；成功时为 null。 */
  readonly note: string | null;
}

/** `attach_cdp` 的入参与产出。 */
export interface CdpAttachRequest {
  readonly pid: number;
}

export interface CdpEndpoint {
  readonly port: number;
  readonly httpEndpoint: string;
  readonly websocketUrl: string;
  readonly product: string;
}
