/**
 * DeskPilot UI map 契约：观测产物的唯一形状。
 *
 * 设计约束（见 `.agents/specs/desk-pilot.md` D2/D3）：
 * - 每个元素必须带来源溯源，模型才能判断该不该信它；
 * - `bounds` 只是诊断信息，永远不允许被当作坐标目标；
 * - `snapshotId` 是 ref 的命名空间，跨 snapshot 寻址必须在进入 adapter 前被拒绝。
 */

/** 平台标识。Linux 的 X11 与 Wayland 是两种后端，不是一种。 */
export type PlatformId = "win32" | "darwin" | "linux-x11" | "linux-wayland";

/** 四级感知阶梯，成本从低到高。 */
export type PerceptionSource = "a11y" | "ocr" | "dom" | "vision";

/** 归一化后的元素角色。平台原生角色映射到此集合，未知角色必须是 `unknown` 而不是猜测。 */
export type ElementKind =
  | "button"
  | "menuitem"
  | "textfield"
  | "textarea"
  | "checkbox"
  | "radio"
  | "combobox"
  | "listitem"
  | "treeitem"
  | "slider"
  | "stepper"
  | "switch"
  | "tab"
  | "table"
  | "row"
  | "cell"
  | "link"
  | "image"
  | "group"
  | "window"
  | "dialog"
  | "menu"
  | "scrollbar"
  | "statusbar"
  | "tooltip"
  | "canvas"
  | "unknown";

/** 元素能力标记。`secure` 一旦置位，其 value 必须在进入模型上下文前脱敏。 */
export type ElementFlag =
  | "pressable"
  | "editable"
  | "settable"
  | "selectable"
  | "focused"
  | "has_menu"
  | "secure"
  | "offscreen";

/** 全局屏幕坐标下的矩形，单位是物理像素。 */
export interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 元素来源溯源。`fingerprint` 是尽力而为的稳定身份，用于跨 observation 匹配。 */
export interface ElementProvenance {
  readonly source: PerceptionSource;
  /** 0..1。a11y 直读为 1，OCR/DOM/vision 按识别置信度给出。 */
  readonly confidence: number;
  /** 采集时的单调时钟毫秒数，用于判断元素是否已过期。 */
  readonly observedAtMs: number;
  /** `role@name@path` 形式；无法稳定取到时允许为空字符串，调用方需按 source 降级信任。 */
  readonly fingerprint: string;
}

/** UiMap 中的一个元素。 */
export interface UiElement {
  /** `@<snapshotId>:e<index>` 形式，由 core 生成，adapter 只负责回填其余字段。 */
  readonly ref: string;
  readonly kind: ElementKind;
  readonly name: string;
  readonly value: string | null;
  /** 诊断用。禁止作为坐标目标，禁止渲染给模型当作可点击区域。 */
  readonly bounds: Bounds | null;
  readonly flags: readonly ElementFlag[];
  /** 元素自报的可执行动作名，`act_on` 的唯一合法来源。不允许模型猜测。 */
  readonly actions: readonly string[];
  readonly provenance: ElementProvenance;
}

/** 目标界面的身份。四个字段必须指向同一个活界面，否则 `IDENTITY_CONFLICT`。 */
export interface SurfaceRef {
  readonly pid: number;
  readonly bundleId: string | null;
  readonly name: string;
  readonly windowId: number | null;
}

/**
 * 坐标目标的帧绑定。
 *
 * 坐标只在这一次 raster 内有效；frameId 变化即失效，必须重新观测而不是重试同一个坐标。
 */
export interface FrameBinding {
  readonly frameId: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly scaleFactor: number;
  readonly capturedAtMs: number;
}

/** 一次观测的完整产物。 */
export interface UiMap {
  readonly snapshotId: string;
  readonly surface: SurfaceRef;
  readonly frame: FrameBinding;
  /** 各来源贡献的元素数量，用于向模型说明这次观测有多可信。 */
  readonly sourceMix: Readonly<Partial<Record<PerceptionSource, number>>>;
  /** 骨架下钻是否被深度截断。 */
  readonly truncated: boolean;
  readonly truncatedAtDepth: number | null;
  readonly elements: readonly UiElement[];
}

/** `surfaces` 工具返回的一行。 */
export interface SurfaceSummary {
  readonly surface: SurfaceRef;
  readonly title: string;
  readonly main: boolean;
  readonly focused: boolean;
  readonly onScreen: boolean;
  readonly bounds: Bounds | null;
}

/** `observe` 的入参。 */
export interface ObserveRequest {
  readonly surface: SurfaceRef;
  /** 骨架下钻深度。缺省为全量；平台原生树过深时由 adapter 截断并置 `truncated`。 */
  readonly depth?: number;
  /** 是否附带 raster。默认 false：正常应用控制不需要视觉输入。 */
  readonly includeRaster?: boolean;
}

/** `inspect` 的入参：一个已解析的元素句柄。 */
export interface ElementHandle {
  readonly snapshotId: string;
  readonly ref: string;
}
