//! 错误码、能力集与线协议信封。
//!
//! 与 `packages/desk-pilot/src/errors.ts` 对应。错误码表是封闭集合：
//! daemon 不允许发明新码，host 侧遇到未知码一律按 `PROTOCOL_VIOLATION` 处理。

use serde::{Deserialize, Serialize};

use crate::ui_map::{PerceptionSource, PlatformId};

/// 错误码。顺序无关，取值与 TS 侧 `DESK_ERROR_CODES` 一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeskErrorCode {
    StaleRef,
    SurfaceReplaced,
    IdentityConflict,
    OwnershipUnproven,
    UnsupportedOnPlatform,
    PermissionDenied,
    ToolTimeout,
    Deviation,
    LeaseNotHeld,
    SubagentUnavailable,
    ProtocolViolation,
    InvalidArgument,
}

impl DeskErrorCode {
    /// 封闭集合的字符串形式，供日志与未知码回退使用。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StaleRef => "STALE_REF",
            Self::SurfaceReplaced => "SURFACE_REPLACED",
            Self::IdentityConflict => "IDENTITY_CONFLICT",
            Self::OwnershipUnproven => "OWNERSHIP_UNPROVEN",
            Self::UnsupportedOnPlatform => "UNSUPPORTED_ON_PLATFORM",
            Self::PermissionDenied => "PERMISSION_DENIED",
            Self::ToolTimeout => "TOOL_TIMEOUT",
            Self::Deviation => "DEVIATION",
            Self::LeaseNotHeld => "LEASE_NOT_HELD",
            Self::SubagentUnavailable => "SUBAGENT_UNAVAILABLE",
            Self::ProtocolViolation => "PROTOCOL_VIOLATION",
            Self::InvalidArgument => "INVALID_ARGUMENT",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccessScope {
    Accessibility,
    ScreenRecording,
    InputMonitoring,
    Automation,
    PortalScreencast,
    PortalRemotedesktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrantState {
    Granted,
    Denied,
    Unknown,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccessReport {
    pub scope: AccessScope,
    pub state: GrantState,
    /// 已授权时为 null；否则是给用户的一句可执行操作。
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrimitiveState {
    Available,
    Degraded,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilitySet {
    pub platform: PlatformId,
    pub session_type: SessionType,
    pub perception: std::collections::BTreeMap<PerceptionSource, PrimitiveState>,
    pub primitives: Primitives,
    pub grants: std::collections::BTreeMap<AccessScope, GrantState>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionType {
    Native,
    X11,
    Wayland,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Primitives {
    pub pointer: bool,
    pub keyboard: bool,
    /// 不抢焦点的语义动作。
    pub semantic: bool,
    pub capture: bool,
    pub clipboard_read: bool,
    pub window_enumerate: bool,
    /// 定向到指定进程的后台输入（macOS `CGEventPostToPid` 一类）。
    pub background_input: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RequestContext {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub workspace_key: Option<String>,
    #[serde(default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub lease_id: Option<String>,
    #[serde(default)]
    pub runtime_scope: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeskRequest {
    pub id: String,
    pub token: String,
    pub method: String,
    #[serde(default)]
    pub input: serde_json::Value,
    #[serde(default)]
    pub context: RequestContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeskResponse {
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<DeskErrorCode>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub possibly_sent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovery: Option<String>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl DeskResponse {
    pub fn ok(id: impl Into<String>, result: serde_json::Value) -> Self {
        Self {
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
            code: None,
            possibly_sent: false,
            recovery: None,
        }
    }

    pub fn error(id: impl Into<String>, code: DeskErrorCode, message: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            ok: false,
            result: None,
            error: Some(message.into()),
            code: Some(code),
            possibly_sent: false,
            recovery: None,
        }
    }
}

/// `capabilities` 之外的一切方法名。用于启动期日志与未知方法拒绝。
pub const DESK_METHODS: [&str; 12] = [
    "capabilities",
    "surfaces",
    "observe",
    "inspect",
    "semantic",
    "pointer",
    "text",
    "key",
    "clipboard",
    "attach_cdp",
    "request_access",
    "shutdown",
];
