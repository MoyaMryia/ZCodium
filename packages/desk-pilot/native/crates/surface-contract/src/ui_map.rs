//! DeskPilot 线协议契约的 Rust 侧。
//!
//! 这个 crate 只放**数据类型**，不放任何平台代码。它与
//! `packages/desk-pilot/src/{ui-map,actuation,errors}.ts` 一一对应，
//! 两侧的字段名通过 `#[serde(rename_all = "snake_case")]` 保持稳定；
//! 任何一侧新增字段都必须同步另一侧，否则 `PROTOCOL_VIOLATION` 会在运行时才暴露。
//!
//! 设计约束见 `.agents/specs/desk-pilot.md`：
//! - `bounds` 是诊断信息，永不作为坐标目标；
//! - 坐标目标必须带 `frame_id`；
//! - `secure` 元素的值必须在进入模型上下文前脱敏（脱敏在 TS 侧做，这里只负责如实置位）；
//! - `possibly_sent` 与 `verification` 正交。

use serde::{Deserialize, Serialize};

/// 线协议版本。daemon 与 host 不一致时直接拒绝，不做隐式兼容。
pub const DESK_IPC_VERSION: u32 = 1;

/// 单条请求的最大字节数。与 TS broker 的 1 MiB 上限保持一致。
pub const MAX_REQUEST_BYTES: usize = 1024 * 1024;

/// 单条响应的最大字节数。截图走 base64，32 MiB 对应约 24 MiB 的 PNG。
pub const MAX_RESPONSE_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlatformId {
    Win32,
    Darwin,
    LinuxX11,
    LinuxWayland,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PerceptionSource {
    A11y,
    Ocr,
    Dom,
    Vision,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementKind {
    Button,
    Menuitem,
    Textfield,
    Textarea,
    Checkbox,
    Radio,
    Combobox,
    Listitem,
    Treeitem,
    Slider,
    Stepper,
    Switch,
    Tab,
    Table,
    Row,
    Cell,
    Link,
    Image,
    Group,
    Window,
    Dialog,
    Menu,
    Scrollbar,
    Statusbar,
    Tooltip,
    Canvas,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ElementFlag {
    Pressable,
    Editable,
    Settable,
    Selectable,
    Focused,
    HasMenu,
    Secure,
    Offscreen,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElementProvenance {
    pub source: PerceptionSource,
    /// 0..1。a11y 直读为 1.0。
    pub confidence: f64,
    /// 单调时钟毫秒。
    pub observed_at_ms: u64,
    /// `role@name@path`；无法稳定取到时允许空串，调用方需按 source 降级信任。
    pub fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiElement {
    /// `@<snapshot_id>:e<index>`
    pub ref_: String,
    pub kind: ElementKind,
    pub name: String,
    pub value: Option<String>,
    /// 诊断用。禁止作为坐标目标。
    pub bounds: Option<Bounds>,
    pub flags: Vec<ElementFlag>,
    /// 元素自报动作，`semantic` 的唯一合法来源。
    pub actions: Vec<String>,
    pub provenance: ElementProvenance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SurfaceRef {
    pub pid: u32,
    pub bundle_id: Option<String>,
    pub name: String,
    pub window_id: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FrameBinding {
    pub frame_id: String,
    pub width_px: u32,
    pub height_px: u32,
    pub scale_factor: f64,
    pub captured_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UiMap {
    pub snapshot_id: String,
    pub surface: SurfaceRef,
    pub frame: FrameBinding,
    pub source_mix: std::collections::BTreeMap<PerceptionSource, u32>,
    pub truncated: bool,
    pub truncated_at_depth: Option<u32>,
    pub elements: Vec<UiElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SurfaceSummary {
    pub surface: SurfaceRef,
    pub title: String,
    pub main: bool,
    pub focused: bool,
    pub on_screen: bool,
    pub bounds: Option<Bounds>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ObserveRequest {
    pub surface: SurfaceRef,
    #[serde(default)]
    pub depth: Option<u32>,
    #[serde(default)]
    pub include_raster: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ElementHandle {
    pub snapshot_id: String,
    #[serde(rename = "ref")]
    pub ref_: String,
}
