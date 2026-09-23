/**
 * 契约使用样例：一次 observe → act_on 的最小闭环。
 *
 * 这个文件是架构策略要求的模块样例件。它刻意不 import 任何实现，
 * 只证明 `SurfaceAdapter` 这一个端口足够表达核心工作流。
 */

import type {
  ObserveRequest,
  SemanticRequest,
  SurfaceAdapter,
  SurfaceRef,
  UiElement,
} from "./contract.js";
import { assertElementTarget } from "./guards.js";

export interface PressableView {
  readonly snapshotId: string;
  readonly elements: readonly UiElement[];
}

/** 观测一个界面，返回可点击元素与它们所属的 snapshot 命名空间。 */
export async function observePressables(
  adapter: SurfaceAdapter,
  surface: SurfaceRef,
): Promise<PressableView> {
  const request: ObserveRequest = { surface, depth: 3 };
  const map = await adapter.observe(request);
  return {
    snapshotId: map.snapshotId,
    elements: map.elements.filter((element) => element.flags.includes("pressable")),
  };
}

/** 对一个元素执行它自己声明的动作，并在进入 adapter 前完成 ref 校验。 */
export async function pressElement(
  adapter: SurfaceAdapter,
  options: { snapshotId: string; ref: string; action: string },
): Promise<string> {
  const target = { kind: "element", snapshotId: options.snapshotId, ref: options.ref } as const;
  assertElementTarget(target, options.snapshotId);
  const request: SemanticRequest = { target, action: options.action };
  const outcome = await adapter.semantic(request);
  return `${outcome.possiblySent ? "sent" : "not-sent"}/${outcome.verification.state}`;
}
