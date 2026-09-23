//! macOS 后端：Accessibility API + ScreenCaptureKit + CGEvent。
//!
//! 原语来源（与闭源 `ax_native.node` 的 macOS 侧一致，但这里是开放实现）：
//! - 可达性树：`AXUIElement*`，属性读 `copy_attribute:AXRole/AXTitle/AXValue/AXPosition/...`，
//!   可写属性 `set_attribute:AXManualAccessibility/AXEnhancedUserInterface/AXValue`
//! - 截图：ScreenCaptureKit（`SCShareableContent` / `SCContentFilter` / `SCStream`）
//! - 输入：`CGEventCreate*` + `CGEventPost`，**定向后台输入用 `CGEventPostToPid`**
//! - 剪贴板：`NSPasteboard`
//! - 调用方身份：Security 框架 `SecCode` / `kSecCodeInfoTeamIdentifier` / `kSecGuestAttributePid`
//!
//! 状态：接口已定义，实现尚未落地。

use surface_contract::PerceptionSource;
use surface_contract::{
    AccessReport, AccessScope, ActuationOutcome, CapabilitySet, CdpAttachRequest, CdpEndpoint,
    ClipboardOp, ClipboardResult, ElementHandle, GrantState, KeyChord, ObserveRequest, PlatformId,
    PointerRequest, PrimitiveState, Primitives, SemanticRequest, SessionType, SurfaceSummary,
    TextRequest, UiElement, UiMap,
};

use super::conservative_capability;
use crate::{BackendError, SurfaceBackend};

/// 可达性树来源。AX 调用必须在有 Accessibility 权限的进程里做；
/// 权限缺失时 `probe` 返回 `PermissionDenied` 而不是半可用的树。
pub trait AxTreeSource: Send + Sync {
    fn list_applications(&self) -> Result<Vec<surface_contract::SurfaceRef>, BackendError>;
    fn read_window_tree(
        &self,
        surface: &surface_contract::SurfaceRef,
        max_depth: Option<u32>,
    ) -> Result<Vec<UiElement>, BackendError>;
    fn read_element(&self, handle: &ElementHandle) -> Result<Option<UiElement>, BackendError>;
    fn element_at_point(&self, x: f64, y: f64) -> Result<Option<UiElement>, BackendError>;
    /// 元素自报的 AX action 名，`semantic` 的唯一合法来源。
    fn actions_for(&self, handle: &ElementHandle) -> Result<Vec<String>, BackendError>;
}

/// 输入注入。`post_to_pid` 是 macOS 独有的定向后台输入，不抢焦点。
pub trait CgEventInjector: Send + Sync {
    fn post_to_pid(&self, pid: u32, chord: &KeyChord) -> Result<(), BackendError>;
    fn post_global(&self, chord: &KeyChord) -> Result<(), BackendError>;
    fn move_pointer(&self, x: f64, y: f64) -> Result<(), BackendError>;
    fn click(&self, x: f64, y: f64, button: &str, clicks: u8) -> Result<(), BackendError>;
    fn scroll(&self, x: f64, y: f64, delta_x: f64, delta_y: f64) -> Result<(), BackendError>;
    fn type_text(&self, text: &str) -> Result<(), BackendError>;
}

/// 帧抓取。窗口级抓取带回证（window id + pid + bundle id）。
pub trait ScFrameGrabber: Send + Sync {
    fn is_supported(&self) -> bool;
    fn capture_display(&self) -> Result<Vec<u8>, BackendError>;
    fn capture_window_verified(
        &self,
        window_id: u64,
        pid: u32,
        expected_bundle_id: &str,
    ) -> Result<Vec<u8>, BackendError>;
}

/// 剪贴板。写入时打自定义 pasteboard 标记，`paste` 据此证明是自己发的。
pub trait MacClipboardIo: Send + Sync {
    fn read_text(&self) -> Result<Option<String>, BackendError>;
    fn write_text_marked(&self, text: &str, marker: &str) -> Result<(), BackendError>;
}

/// 调用方身份校验。拒绝非本 Team ID 的连接。
pub trait CodeSignVerifier: Send + Sync {
    fn team_id_for_pid(&self, pid: u32) -> Result<Option<String>, BackendError>;
}

pub struct DarwinBackend {
    capability: CapabilitySet,
}

impl DarwinBackend {
    pub fn probe() -> Result<Self, BackendError> {
        let mut capability = conservative_capability(PlatformId::Darwin, SessionType::Native);
        capability
            .perception
            .insert(PerceptionSource::A11y, PrimitiveState::Available);
        capability
            .perception
            .insert(PerceptionSource::Ocr, PrimitiveState::Degraded);
        capability
            .perception
            .insert(PerceptionSource::Vision, PrimitiveState::Available);
        capability.primitives = Primitives {
            pointer: true,
            keyboard: true,
            semantic: true,
            capture: true,
            clipboard_read: true,
            window_enumerate: true,
            // CGEventPostToPid：定向到指定进程的后台输入，不抢焦点。
            background_input: true,
        };
        capability
            .grants
            .insert(AccessScope::Accessibility, GrantState::Unknown);
        capability
            .grants
            .insert(AccessScope::ScreenRecording, GrantState::Unknown);
        capability
            .grants
            .insert(AccessScope::InputMonitoring, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::Automation, GrantState::Unknown);
        capability
            .grants
            .insert(AccessScope::PortalScreencast, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::PortalRemotedesktop, GrantState::NotApplicable);
        capability.notes = vec![
            "accessibility and screen recording grants are probed lazily; see request_access"
                .to_string(),
        ];
        Ok(Self { capability })
    }
}

impl SurfaceBackend for DarwinBackend {
    fn capabilities(&self) -> Result<CapabilitySet, BackendError> {
        Ok(self.capability.clone())
    }

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError> {
        Err(BackendError::not_implemented("darwin surfaces"))
    }

    fn observe(&self, _request: &ObserveRequest) -> Result<UiMap, BackendError> {
        Err(BackendError::not_implemented("darwin observe"))
    }

    fn inspect(&self, _handle: &ElementHandle) -> Result<Option<UiElement>, BackendError> {
        Err(BackendError::not_implemented("darwin inspect"))
    }

    fn semantic(&self, _request: &SemanticRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("darwin semantic"))
    }

    fn pointer(&self, _request: &PointerRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("darwin pointer"))
    }

    fn text(&self, _request: &TextRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("darwin text"))
    }

    fn key(&self, _chord: &KeyChord) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("darwin key"))
    }

    fn clipboard(&self, _op: &ClipboardOp) -> Result<ClipboardResult, BackendError> {
        Err(BackendError::not_implemented("darwin clipboard"))
    }

    fn attach_cdp(&self, _request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError> {
        Err(BackendError::not_implemented("darwin attach_cdp"))
    }

    fn request_access(&self, scope: AccessScope) -> Result<AccessReport, BackendError> {
        Ok(AccessReport {
            scope,
            state: self
                .capability
                .grants
                .get(&scope)
                .copied()
                .unwrap_or(GrantState::NotApplicable),
            remediation: None,
        })
    }

    fn shutdown(&self) -> Result<(), BackendError> {
        Ok(())
    }
}
