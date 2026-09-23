/**
 * DeskPilot 纯校验层。
 *
 * 这一层不做任何 IO、不碰进程、不碰定时器，只把"这个请求能不能进 adapter"判断清楚。
 * 所有在这里失败的请求都必须是 `possiblySent: false`——平台还没被碰过。
 */

import type { ActionTarget, KeyChord, KeyModifier } from "./actuation.js";
import type { PlatformId, UiElement } from "./ui-map.js";
import type { CapabilitySet } from "./errors.js";
import { DeskPilotError } from "./errors.js";

const REF_PATTERN = /^@(?<snapshot>[A-Za-z0-9_-]{1,64}):e(?<index>[1-9][0-9]{0,5})$/;

export interface ParsedElementRef {
  readonly snapshotId: string;
  readonly index: number;
}

/** 解析 `@<snapshotId>:e<index>`。格式非法返回 null，由调用方决定错误码。 */
export function parseElementRef(ref: string): ParsedElementRef | null {
  const match = REF_PATTERN.exec(ref);
  const snapshotId = match?.groups?.snapshot;
  const rawIndex = match?.groups?.index;
  if (!snapshotId || rawIndex === undefined) return null;
  const index = Number.parseInt(rawIndex, 10);
  if (!Number.isSafeInteger(index) || index < 1) return null;
  return { snapshotId, index };
}

/**
 * 校验元素目标。
 *
 * 跨 snapshot 寻址一律拒绝：ref 只在它自己的 snapshot 命名空间内有效，
 * 放过一个过期 ref 会让模型对着已经重排过的 UI 点击。
 */
export function assertElementTarget(target: ActionTarget, latestSnapshotId: string): void {
  if (target.kind !== "element") return;
  const parsed = parseElementRef(target.ref);
  if (!parsed) {
    throw new DeskPilotError({
      code: "INVALID_ARGUMENT",
      message: `malformed element ref: ${target.ref}`,
      possiblySent: false,
      recovery: "Use a ref exactly as returned by the latest observe call.",
    });
  }
  if (parsed.snapshotId !== latestSnapshotId) {
    throw new DeskPilotError({
      code: "STALE_REF",
      message: `element ref ${target.ref} belongs to snapshot ${parsed.snapshotId}, latest is ${latestSnapshotId}`,
      possiblySent: false,
      recovery: "Call observe again and re-pick the index from the fresh UiMap.",
    });
  }
}

/**
 * 校验坐标目标。
 *
 * 没有 frameId 的坐标一律拒绝：坐标离开当次 raster 就失去意义，
 * 放过去等于让模型在错误的缩放比上点击。
 */
export function assertCoordinateTarget(target: ActionTarget): void {
  if (target.kind !== "coordinate") return;
  if (target.frameId.trim().length === 0) {
    throw new DeskPilotError({
      code: "INVALID_ARGUMENT",
      message: "coordinate target requires a frameId",
      possiblySent: false,
      recovery:
        "Use the frameId from the raster returned by observe; bare coordinates are not addressable.",
    });
  }
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    throw new DeskPilotError({
      code: "INVALID_ARGUMENT",
      message: "coordinate target requires finite x/y",
      possiblySent: false,
      recovery: "Use integer pixel coordinates inside the raster returned by observe.",
    });
  }
  if (!Number.isInteger(target.x) || !Number.isInteger(target.y)) {
    throw new DeskPilotError({
      code: "INVALID_ARGUMENT",
      message: `coordinate target requires integer x/y, got (${target.x}, ${target.y})`,
      possiblySent: false,
      recovery: "Round to integer pixels; sub-pixel coordinates are not addressable.",
    });
  }
  if (target.x < 0 || target.y < 0) {
    throw new DeskPilotError({
      code: "INVALID_ARGUMENT",
      message: `coordinate target out of raster: (${target.x}, ${target.y})`,
      possiblySent: false,
      recovery: "Coordinates are raster-relative and must be non-negative.",
    });
  }
}

/** 修饰键跨平台归一：非 darwin 上 `cmd` 就是 `ctrl`，模型不需要分辨。 */
export function normalizeKeyChord(chord: KeyChord, platform: PlatformId): KeyChord {
  if (platform === "darwin") return chord;
  const modifiers = chord.modifiers.map(
    (modifier): KeyModifier => (modifier === "cmd" ? "ctrl" : modifier),
  );
  return { key: chord.key, modifiers };
}

/** 密码字段的值在进入模型上下文前必须变成这个。 */
export function redactSecureValue(value: string | null): string | null {
  return value === null ? null : "«redacted»";
}

/** 元素是否携带敏感标记。adapter 必须在产出 UiMap 时如实置位。 */
export function isSecureElement(element: UiElement): boolean {
  return element.flags.includes("secure");
}

/**
 * 冻结能力集。
 *
 * daemon 只在启动时上报一次；之后的任何变更都必须重启 daemon，
 * 运行期改写能力集会让模型的工具表和行为预期悄悄漂移。
 */
export function freezeCapabilitySet(capability: CapabilitySet): CapabilitySet {
  return Object.freeze({
    ...capability,
    perception: Object.freeze({ ...capability.perception }),
    primitives: Object.freeze({ ...capability.primitives }),
    grants: Object.freeze({ ...capability.grants }),
    notes: Object.freeze([...capability.notes]),
  });
}
