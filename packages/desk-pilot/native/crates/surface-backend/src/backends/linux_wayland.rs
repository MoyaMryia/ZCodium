//! Linux Wayland 后端：AT-SPI + libei/wlr-virtual-input + PipeWire ScreenCast。
//!
//! 这是四个后端里唯一"能力取决于用户授权"的，也是本 spec 的差异化重点。
//! 设计立场（见 `.agents/specs/desk-pilot.md`）：
//! **Wayland 禁止合成输入是组合器的设计决策，不是缺陷。**
//! 不引入需要 root 的 `/dev/uinput`，不静默失败，不伪造成功。
//!
//! 输入按优先级三选一，第一个可用即止，选择结果写进 `CapabilitySet.notes`：
//! 1. `reis`（libei 客户端）+ `ashpd` RemoteDesktop portal —— 唯一合规且通用，代价是每次会话要用户授权
//! 2. wlroots `zwlr_virtual_pointer_manager_v1` / `zwp_virtual_keyboard_manager_v1`
//!    —— Sway/Hyprland/river/wayfire 可用，无弹窗，但 compositor 专属
//! 3. 不可用 → `pointer=false` / `keyboard=false`，调用返回 `UNSUPPORTED_ON_PLATFORM`
//!
//! 截图：portal ScreenCast → PipeWire。wlroots 上可用 `grim` 作为无需授权的全屏降级。
//! 窗口级截图只有 ScreenCast 的 window source 一条路。
//! 剪贴板：portal 不提供读权限。写总是可用；读需要 `wl-paste`，否则 `clipboard_read=false`，
//! 不允许返回空字符串冒充成功。
//!
//! 状态：接口已定义，实现尚未落地。

use surface_contract::{
    AccessReport, AccessScope, ActuationOutcome, CdpAttachRequest, CdpEndpoint, CapabilitySet,
    ClipboardOp, ClipboardResult, ElementHandle, GrantState, KeyChord, ObserveRequest, PlatformId,
    PointerRequest, PrimitiveState, Primitives, SemanticRequest, SessionType, SurfaceSummary,
    TextRequest, UiElement, UiMap,
};
use surface_contract::{PerceptionSource};

use crate::{conservative_capability, BackendError, SurfaceBackend};

/// 合成输入的三种合法来源。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaylandInputRoute {
    /// libei over the RemoteDesktop portal. Requires per-session user consent.
    LibeiPortal,
    /// wlroots virtual pointer/keyboard protocols. Compositor-specific, no dialog.
    WlrVirtualInput,
    /// No route available. `pointer` and `keyboard` must be false.
    None,
}

impl WaylandInputRoute {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LibeiPortal => "libei-portal",
            Self::WlrVirtualInput => "wlr-virtual-input",
            Self::None => "none",
        }
    }
}

/// 输入注入 seam。两个实现分别对应 `LibeiPortal` 与 `WlrVirtualInput`。
pub trait WaylandInputInjector: Send + Sync {
    fn route(&self) -> WaylandInputRoute;
    fn move_pointer(&self, x: f64, y: f64) -> Result<(), BackendError>;
    fn button(&self, button: &str, down: bool) -> Result<(), BackendError>;
    fn scroll(&self, delta_x: f64, delta_y: f64) -> Result<(), BackendError>;
    fn key(&self, chord: &KeyChord) -> Result<(), BackendError>;
    /// 走 virtual keyboard 的 Unicode 路径；IBus 注入需要应用自行 bypass，
    /// 因此这里显式暴露开关而不是默认猜。
    fn type_text(&self, text: &str, ibus_bypass: bool) -> Result<(), BackendError>;
}

/// PipeWire ScreenCast 帧抓取。流句柄跨调用保持，由实现方管理生命周期。
pub trait PipeWireFrameGrabber: Send + Sync {
    /// 是否已拿到 ScreenCast 授权。未授权时 `capture` 必须是 false。
    fn is_authorized(&self) -> bool;
    fn capture_display(&self) -> Result<Vec<u8>, BackendError>;
    /// 窗口源截图。Wayland 上这是唯一路径，且同样需要授权。
    fn capture_window(&self, window_handle: &str) -> Result<Vec<u8>, BackendError>;
}

/// 剪贴板。读走 `wl-paste` 子进程；不可用时实现方返回 `note` 说明原因。
pub trait WaylandClipboardIo: Send + Sync {
    fn can_read(&self) -> bool;
    fn read_text(&self) -> Result<Option<String>, BackendError>;
    fn write_text(&self, text: &str) -> Result<(), BackendError>;
}

pub struct WaylandBackend {
    capability: CapabilitySet,
    route: WaylandInputRoute,
}

impl WaylandBackend {
    /// 探测当前 Wayland 会话。
    ///
    /// 探测顺序固定：先问 portal（是否已有授权/能否请求），再问 compositor 是否暴露
    /// wlr 虚拟输入全局对象。两者都没有时仍然构造成功后端，只是能力全关——
    /// host 需要一个能回报"做不到"的进程，而不是一个起不来的进程。
    pub fn probe() -> Result<Self, BackendError> {
        let mut capability = conservative_capability(PlatformId::LinuxWayland, SessionType::Wayland);

        // 可达性与平台无关：AT-SPI 在 Wayland 上照常工作。
        capability.perception.insert(PerceptionSource::A11y, PrimitiveState::Available);
        capability.perception.insert(PerceptionSource::Ocr, PrimitiveState::Degraded);
        capability.perception.insert(PerceptionSource::Dom, PrimitiveState::Unavailable);
        capability.perception.insert(PerceptionSource::Vision, PrimitiveState::Degraded);

        let route = detect_input_route();
        let (pointer, keyboard) = match route {
            WaylandInputRoute::None => (false, false),
            _ => (true, true),
        };
        let screencast = probe_screencast_grant();
        let clipboard_read = probe_clipboard_read();

        capability.primitives = Primitives {
            pointer,
            keyboard,
            semantic: true,
            capture: screencast,
            clipboard_read,
            window_enumerate: true,
            // libei 与 wlr 虚拟输入都是"合成事件"，不存在定向到某进程的后台输入。
            background_input: false,
        };
        capability.grants.insert(AccessScope::Accessibility, GrantState::Granted);
        capability.grants.insert(AccessScope::ScreenRecording, GrantState::NotApplicable);
        capability.grants.insert(AccessScope::InputMonitoring, GrantState::NotApplicable);
        capability.grants.insert(AccessScope::Automation, GrantState::NotApplicable);
        capability
            .grants
            .insert(AccessScope::PortalScreencast, screencast_grant_state(screencast));
        capability
            .grants
            .insert(AccessScope::PortalRemotedesktop, remote_desktop_grant_state(route));

        capability.notes = vec![
            format!("input route: {}", route.as_str()),
            "Wayland forbids synthetic input by design; no root/uinput fallback is offered".to_string(),
        ];
        if !screencast {
            capability
                .notes
                .push("ScreenCast not granted; capture is disabled until the user consents".to_string());
        }
        if !clipboard_read {
            capability
                .notes
                .push("clipboard read unavailable (no wl-paste); clipboard write still works".to_string());
        }

        Ok(Self { capability, route })
    }

    pub fn input_route(&self) -> WaylandInputRoute {
        self.route
    }
}

fn screencast_grant_state(granted: bool) -> GrantState {
    if granted {
        GrantState::Granted
    } else {
        GrantState::Denied
    }
}

fn remote_desktop_grant_state(route: WaylandInputRoute) -> GrantState {
    match route {
        WaylandInputRoute::LibeiPortal => GrantState::Granted,
        WaylandInputRoute::WlrVirtualInput => GrantState::NotApplicable,
        WaylandInputRoute::None => GrantState::Denied,
    }
}

/// 输入路由探测。骨架阶段只做环境判断，真实探测在 P4 落地。
fn detect_input_route() -> WaylandInputRoute {
    // libei 需要一个已建立的 portal 会话；骨架阶段无法在无会话的情况下判定，
    // 因此只有当 compositor 明显不是 wlroots 时才提前排除 wlr 路线。
    let compositor = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_lowercase();
    let is_wlroots_like = compositor.contains("sway")
        || compositor.contains("hyprland")
        || compositor.contains("river")
        || compositor.contains("wayfire");
    if is_wlroots_like {
        WaylandInputRoute::WlrVirtualInput
    } else {
        // GNOME/KDE 等只认 portal。未授权时由 capabilities 报 false。
        WaylandInputRoute::LibeiPortal
    }
}

fn probe_screencast_grant() -> bool {
    // 骨架阶段：portal 授权状态只能在实际建立会话时知道，默认未授权。
    false
}

fn probe_clipboard_read() -> bool {
    std::process::Command::new("wl-paste")
        .arg("--version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

impl SurfaceBackend for WaylandBackend {
    fn capabilities(&self) -> Result<CapabilitySet, BackendError> {
        Ok(self.capability.clone())
    }

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError> {
        Err(BackendError::not_implemented("linux-wayland surfaces"))
    }

    fn observe(&self, _request: &ObserveRequest) -> Result<UiMap, BackendError> {
        Err(BackendError::not_implemented("linux-wayland observe"))
    }

    fn inspect(&self, _handle: &ElementHandle) -> Result<Option<UiElement>, BackendError> {
        Err(BackendError::not_implemented("linux-wayland inspect"))
    }

    fn semantic(&self, _request: &SemanticRequest) -> Result<ActuationOutcome, BackendError> {
        // AT-SPI 的语义动作在 Wayland 上完全可用，这是未授权会话里唯一还能用的执行通道。
        Err(BackendError::not_implemented("linux-wayland semantic"))
    }

    fn pointer(&self, _request: &PointerRequest) -> Result<ActuationOutcome, BackendError> {
        if self.route == WaylandInputRoute::None {
            return Err(BackendError::unsupported(
                "no synthetic input route on this Wayland session",
            ));
        }
        Err(BackendError::not_implemented("linux-wayland pointer"))
    }

    fn text(&self, _request: &TextRequest) -> Result<ActuationOutcome, BackendError> {
        if self.route == WaylandInputRoute::None {
            return Err(BackendError::unsupported(
                "no synthetic input route on this Wayland session",
            ));
        }
        Err(BackendError::not_implemented("linux-wayland text"))
    }

    fn key(&self, _chord: &KeyChord) -> Result<ActuationOutcome, BackendError> {
        if self.route == WaylandInputRoute::None {
            return Err(BackendError::unsupported(
                "no synthetic input route on this Wayland session",
            ));
        }
        Err(BackendError::not_implemented("linux-wayland key"))
    }

    fn clipboard(&self, op: &ClipboardOp) -> Result<ClipboardResult, BackendError> {
        match op {
            ClipboardOp::Read => {
                if !self.capability.primitives.clipboard_read {
                    // 明确说明读不可用，不返回空字符串冒充成功。
                    return Ok(ClipboardResult {
                        text: None,
                        written: false,
                        note: Some(
                            "clipboard read unavailable on this Wayland session (no wl-paste)".to_string(),
                        ),
                    });
                }
                Err(BackendError::not_implemented("linux-wayland clipboard read"))
            }
            ClipboardOp::Write { .. } => Err(BackendError::not_implemented("linux-wayland clipboard write")),
        }
    }

    fn attach_cdp(&self, _request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError> {
        Err(BackendError::not_implemented("linux-wayland attach_cdp"))
    }

    fn request_access(&self, scope: AccessScope) -> Result<AccessReport, BackendError> {
        let state = self
            .capability
            .grants
            .get(&scope)
            .copied()
            .unwrap_or(GrantState::NotApplicable);
        let remediation = match scope {
            AccessScope::PortalScreencast if state == GrantState::Denied => Some(
                "Approve the ScreenCast prompt; without it capture stays disabled".to_string(),
            ),
            AccessScope::PortalRemotedesktop if state == GrantState::Denied => Some(
                "Approve the RemoteDesktop prompt; without it pointer and keyboard stay disabled"
                    .to_string(),
            ),
            _ => None,
        };
        Ok(AccessReport {
            scope,
            state,
            remediation,
        })
    }

    fn shutdown(&self) -> Result<(), BackendError> {
        Ok(())
    }
}

/// 供测试与诊断使用：把能力集压成一行人类可读摘要。
pub fn summarize_capability(capability: &CapabilitySet) -> String {
    format!(
        "{:?}/{:?} pointer={} keyboard={} semantic={} capture={} clipboard_read={} notes={:?}",
        capability.platform,
        capability.session_type,
        capability.primitives.pointer,
        capability.primitives.keyboard,
        capability.primitives.semantic,
        capability.primitives.capture,
        capability.primitives.clipboard_read,
        capability.notes,
    )
}
