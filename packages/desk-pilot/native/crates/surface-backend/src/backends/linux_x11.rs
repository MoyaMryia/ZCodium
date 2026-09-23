//! Linux X11 后端：AT-SPI + XTest + XGetImage。
//!
//! 原语来源：
//! - 可达性树：AT-SPI2 over D-Bus（`atspi` crate，纯 Rust，**不需要 `python3-gi`**）
//! - 输入：XTest 扩展（`x11rb`）。XTest 只能作用于**前台**窗口；
//!   `XSendEvent` 大多数客户端会忽略，不作为输入路径。
//! - 截图：`XGetImage` 全屏 + 按窗口几何裁剪
//! - 剪贴板：X11 selection（`CLIPBOARD` / `PRIMARY`）
//! - 窗口枚举：EWMH `_NET_CLIENT_LIST` + `_NET_ACTIVE_WINDOW`
//!
//! 状态：接口已定义，实现尚未落地。

use surface_contract::{
    AccessReport, AccessScope, ActuationOutcome, Bounds, CdpAttachRequest, CdpEndpoint, CapabilitySet,
    ClipboardOp, ClipboardResult, ElementHandle, GrantState, KeyChord, ObserveRequest, PlatformId,
    PointerRequest, PrimitiveState, Primitives, SemanticRequest, SessionType, SurfaceRef,
    SurfaceSummary, TextRequest, UiElement, UiMap,
};
use surface_contract::{PerceptionSource};

use crate::{conservative_capability, BackendError, SurfaceBackend};

/// AT-SPI 树来源。实现方负责 D-Bus 连接与 `atspi` proxy 生命周期。
pub trait AtspiTreeSource: Send + Sync {
    /// 通过 org.a11y.Bus 的可访问应用列表枚举桌面应用。
    fn list_applications(&self) -> Result<Vec<SurfaceRef>, BackendError>;
    fn read_window_tree(
        &self,
        surface: &SurfaceRef,
        max_depth: Option<u32>,
    ) -> Result<Vec<UiElement>, BackendError>;
    fn read_element(&self, handle: &ElementHandle) -> Result<Option<UiElement>, BackendError>;
    fn element_at_point(&self, x: f64, y: f64) -> Result<Option<UiElement>, BackendError>;
}

/// XTest 输入注入。只作用于前台窗口。
pub trait XTestInjector: Send + Sync {
    fn move_pointer(&self, x: f64, y: f64) -> Result<(), BackendError>;
    fn button(&self, button: &str, down: bool) -> Result<(), BackendError>;
    fn wheel(&self, delta_x: f64, delta_y: f64) -> Result<(), BackendError>;
    fn key(&self, chord: &KeyChord) -> Result<(), BackendError>;
    /// 走 XIM/XKB 的 Unicode 输入；非拉丁文本必须走这里而不是逐键码。
    fn type_text(&self, text: &str) -> Result<(), BackendError>;
}

/// `XGetImage` 帧抓取。
pub trait X11FrameGrabber: Send + Sync {
    fn capture_root(&self) -> Result<Vec<u8>, BackendError>;
    fn capture_region(&self, bounds: Bounds) -> Result<Vec<u8>, BackendError>;
}

/// X11 selection 剪贴板。读需要持有 selection owner，超时由实现方定义。
pub trait X11ClipboardIo: Send + Sync {
    fn read_text(&self, selection: &str) -> Result<Option<String>, BackendError>;
    fn write_text(&self, selection: &str, text: &str) -> Result<(), BackendError>;
}

pub struct X11Backend {
    capability: CapabilitySet,
}

impl X11Backend {
    pub fn probe() -> Result<Self, BackendError> {
        let mut capability = conservative_capability(PlatformId::LinuxX11, SessionType::X11);
        capability.perception.insert(PerceptionSource::A11y, PrimitiveState::Available);
        capability.perception.insert(PerceptionSource::Ocr, PrimitiveState::Degraded);
        capability.perception.insert(PerceptionSource::Vision, PrimitiveState::Available);
        capability.primitives = Primitives {
            pointer: true,
            keyboard: true,
            semantic: true,
            capture: true,
            clipboard_read: true,
            window_enumerate: true,
            // XTest 只作用于前台窗口，没有"定向到某进程"的后台输入。
            background_input: false,
        };
        for scope in [
            AccessScope::Accessibility,
            AccessScope::ScreenRecording,
            AccessScope::InputMonitoring,
            AccessScope::Automation,
            AccessScope::PortalScreencast,
            AccessScope::PortalRemotedesktop,
        ] {
            capability.grants.insert(scope, GrantState::NotApplicable);
        }
        capability.notes = vec![
            "input reaches the foreground window only; AT-SPI semantic actions do not steal focus"
                .to_string(),
        ];
        Ok(Self { capability })
    }
}

impl SurfaceBackend for X11Backend {
    fn capabilities(&self) -> Result<CapabilitySet, BackendError> {
        Ok(self.capability.clone())
    }

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError> {
        Err(BackendError::not_implemented("linux-x11 surfaces"))
    }

    fn observe(&self, _request: &ObserveRequest) -> Result<UiMap, BackendError> {
        Err(BackendError::not_implemented("linux-x11 observe"))
    }

    fn inspect(&self, _handle: &ElementHandle) -> Result<Option<UiElement>, BackendError> {
        Err(BackendError::not_implemented("linux-x11 inspect"))
    }

    fn semantic(&self, _request: &SemanticRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("linux-x11 semantic"))
    }

    fn pointer(&self, _request: &PointerRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("linux-x11 pointer"))
    }

    fn text(&self, _request: &TextRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("linux-x11 text"))
    }

    fn key(&self, _chord: &KeyChord) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::not_implemented("linux-x11 key"))
    }

    fn clipboard(&self, _op: &ClipboardOp) -> Result<ClipboardResult, BackendError> {
        Err(BackendError::not_implemented("linux-x11 clipboard"))
    }

    fn attach_cdp(&self, _request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError> {
        Err(BackendError::not_implemented("linux-x11 attach_cdp"))
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
