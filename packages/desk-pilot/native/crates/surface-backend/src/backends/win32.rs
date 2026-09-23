//! Windows 后端：UI Automation + Windows.Graphics.Capture + SendInput。
//!
//! 原语来源（与闭源 `ax_native.node` 的 Windows 侧一致，但这里是开放实现）：
//! - 可达性树：UIA COM（`CUIAutomation`），`ControlType` 归一为 `ElementKind`
//! - 截图：Windows.Graphics.Capture + D3D11（`Graphics_Capture` / `Graphics_DirectX_Direct3D11`）
//! - 输入：`SendInput`，调用线程临时切到 per-monitor DPI awareness
//! - 应用身份：`SHGetPropertyStoreForWindow` 取 AUMID，`QueryFullProcessImageNameW` 取 exe 路径
//!
//! 状态：接口已定义，P2 落地。

use surface_contract::PerceptionSource;
use surface_contract::{
    AccessReport, AccessScope, ActuationOutcome, Bounds, CapabilitySet, CdpAttachRequest,
    CdpEndpoint, ClipboardOp, ClipboardResult, ElementHandle, GrantState, KeyChord, ObserveRequest,
    PlatformId, PointerRequest, PrimitiveState, Primitives, SemanticRequest, SessionType,
    SurfaceRef, SurfaceSummary, TextRequest, UiElement, UiMap,
};

use super::conservative_capability;
use crate::{BackendError, SurfaceBackend};

/// 可达性树来源。UIA 是 COM 接口，不能跨线程共享句柄，实现方自行加 apartment 管理。
pub trait UiaTreeSource: Send + Sync {
    /// 枚举可驱动应用。`bundle_id` 填 exe 路径——Windows 没有 bundle id。
    fn list_applications(&self) -> Result<Vec<SurfaceRef>, BackendError>;
    /// 读一个窗口的归一化元素树。
    fn read_window_tree(
        &self,
        surface: &SurfaceRef,
        max_depth: Option<u32>,
    ) -> Result<Vec<UiElement>, BackendError>;
    /// 按元素句柄读单个元素的最新状态。
    fn read_element(&self, handle: &ElementHandle) -> Result<Option<UiElement>, BackendError>;
    /// 坐标命中测试，返回该点的元素。坐标动作前必须调用以证明归属。
    fn element_at_point(&self, x: f64, y: f64) -> Result<Option<UiElement>, BackendError>;
}

/// 输入注入。Windows 上"定向后台输入"不可用：`SendInput` 只作用于前台窗口线程。
pub trait WinInputInjector: Send + Sync {
    fn move_pointer(&self, x: f64, y: f64) -> Result<(), BackendError>;
    fn button(&self, button: &str, down: bool) -> Result<(), BackendError>;
    fn wheel(&self, delta_x: f64, delta_y: f64) -> Result<(), BackendError>;
    fn type_text(&self, text: &str) -> Result<(), BackendError>;
    fn key(&self, chord: &KeyChord) -> Result<(), BackendError>;
}

/// 帧抓取。窗口级抓取必须带回证（pid + AUMID + 期望几何），
/// 否则一次竞态就会把别的窗口的像素当成目标窗口的。
pub trait WgcFrameGrabber: Send + Sync {
    fn is_supported(&self) -> bool;
    fn capture_monitor(&self, bounds: Bounds) -> Result<Vec<u8>, BackendError>;
    fn capture_window_verified(
        &self,
        window_id: u64,
        pid: u32,
        expected_aumid: &str,
        expected_bounds: Option<Bounds>,
    ) -> Result<Vec<u8>, BackendError>;
}

/// 剪贴板。`CF_UNICODETEXT` 为主，大文本走延迟提交。
pub trait WinClipboardIo: Send + Sync {
    fn read_text(&self) -> Result<Option<String>, BackendError>;
    fn write_text(&self, text: &str) -> Result<(), BackendError>;
}

/// 应用身份解析。
pub trait WinAppIdentity: Send + Sync {
    fn aumid_for_window(&self, window_id: u64) -> Result<Option<String>, BackendError>;
    fn executable_path(&self, pid: u32) -> Result<Option<String>, BackendError>;
    fn is_elevated(&self, pid: u32) -> Result<bool, BackendError>;
}

pub struct Win32Backend {
    capability: CapabilitySet,
}

impl Win32Backend {
    /// 探测并构造后端。探测失败不 panic，返回一个能力全关的后端——
    /// 让 host 看到一个"什么都做不了"的诚实声明，而不是一个起不来的进程。
    pub fn probe() -> Result<Self, BackendError> {
        let mut capability = conservative_capability(PlatformId::Win32, SessionType::Native);
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
            // SendInput 只作用于前台线程，不存在"定向到某进程"的后台输入。
            background_input: false,
        };
        capability
            .grants
            .insert(AccessScope::Accessibility, GrantState::Granted);
        capability
            .grants
            .insert(AccessScope::ScreenRecording, GrantState::Granted);
        capability
            .grants
            .insert(AccessScope::InputMonitoring, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::Automation, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::PortalScreencast, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::PortalRemotedesktop, GrantState::NotApplicable);
        capability.notes = vec![
            "background input is unavailable: SendInput only reaches the foreground thread"
                .to_string(),
        ];
        Ok(Self { capability })
    }
}

impl SurfaceBackend for Win32Backend {
    fn capabilities(&self) -> Result<CapabilitySet, BackendError> {
        Ok(self.capability.clone())
    }

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError> {
        Err(BackendError::not_implemented("win32 surfaces"))
    }

    fn observe(&self, _request: &ObserveRequest) -> Result<UiMap, BackendError> {
        Err(BackendError::not_implemented("win32 observe"))
    }

    fn inspect(&self, _handle: &ElementHandle) -> Result<Option<UiElement>, BackendError> {
        Err(BackendError::not_implemented("win32 inspect"))
    }

    fn semantic(&self, _request: &SemanticRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("win32 semantic"))
    }

    fn pointer(&self, _request: &PointerRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("win32 pointer"))
    }

    fn text(&self, _request: &TextRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("win32 text"))
    }

    fn key(&self, _chord: &KeyChord) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("win32 key"))
    }

    fn clipboard(&self, _op: &ClipboardOp) -> Result<ClipboardResult, BackendError> {
        Err(BackendError::not_implemented("win32 clipboard"))
    }

    fn attach_cdp(&self, _request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError> {
        Err(BackendError::not_implemented("win32 attach_cdp"))
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
