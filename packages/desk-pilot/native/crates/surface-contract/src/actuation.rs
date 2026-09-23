//! 执行侧契约：目标、手势、期望与结果。
//!
//! 与 `packages/desk-pilot/src/actuation.ts` 对应。

use serde::{Deserialize, Serialize};

use crate::ui_map::{Bounds, SurfaceRef};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActionTarget {
    Element { snapshot_id: String, ref_: String },
    /// 坐标目标。`frame_id` 为空即非法，host 侧在进入 daemon 前就会拒绝。
    Coordinate { frame_id: String, x: f64, y: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PointerButton {
    Left,
    Right,
    Middle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KeyModifier {
    Cmd,
    Ctrl,
    Alt,
    Shift,
    Win,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyChord {
    pub key: String,
    #[serde(default)]
    pub modifiers: Vec<KeyModifier>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PointerGesture {
    Click {
        button: PointerButton,
        clicks: u8,
        #[serde(default)]
        modifiers: Vec<KeyModifier>,
    },
    Drag {
        from: Bounds,
        to: Bounds,
        button: PointerButton,
    },
    Scroll { delta_x: f64, delta_y: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextRange {
    pub start: u32,
    pub length: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TextOp {
    Type { text: String },
    Set { value: String },
    Select { range: TextRange },
    Paste { text: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "predicate", rename_all = "snake_case")]
pub enum Expectation {
    ElementGone { target: ActionTarget },
    ElementPresent { target: ActionTarget },
    ValueIs { target: ActionTarget, value: String },
    SurfaceTitleIs { surface: SurfaceRef, text: String },
}

/// 破坏性动作的统一信封。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActuationEnvelope {
    pub target: ActionTarget,
    #[serde(default)]
    pub expect: Option<Expectation>,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SemanticRequest {
    #[serde(flatten)]
    pub envelope: ActuationEnvelope,
    pub action: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PointerRequest {
    #[serde(flatten)]
    pub envelope: ActuationEnvelope,
    pub gesture: PointerGesture,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TextRequest {
    #[serde(flatten)]
    pub envelope: ActuationEnvelope,
    pub op: TextOp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum Verification {
    Verified { evidence: String },
    Deviation { expected: String, observed: String },
    Unverified { reason: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActuationOutcome {
    /// 指令是否已下达到平台。参数校验失败必须是 false。
    pub possibly_sent: bool,
    pub verification: Verification,
    pub snapshot_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClipboardOp {
    Read,
    Write { text: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClipboardResult {
    pub text: Option<String>,
    pub written: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CdpAttachRequest {
    pub pid: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CdpEndpoint {
    pub port: u16,
    pub http_endpoint: String,
    pub websocket_url: String,
    pub product: String,
}
