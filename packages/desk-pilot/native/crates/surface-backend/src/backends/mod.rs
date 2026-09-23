//! 后端选择与四个平台模块。
//!
//! 每个模块只在自己的目标平台上编译：Windows 后端依赖 `windows` crate，
//! macOS 后端依赖 `objc2`，两者都不能在 Linux 上构建。
//! Linux 的两个后端（X11 / Wayland）在同一个目标上编译，因为在 Linux 上
//! 跑的是哪个后端是**运行时**决定的（`XDG_SESSION_TYPE` / `WAYLAND_DISPLAY`），
//! 不是编译期能知道的。

use std::sync::Arc;

use surface_contract::{CapabilitySet, PlatformId, SessionType};
use surface_contract::{AccessScope, GrantState, PrimitiveState, Primitives};

use crate::{BackendError, SurfaceBackend};

#[cfg(target_os = "windows")]
pub mod win32;
#[cfg(target_os = "macos")]
pub mod darwin;
#[cfg(target_os = "linux")]
pub mod linux_x11;
#[cfg(target_os = "linux")]
pub mod linux_wayland;

/// 运行时选择后端。
///
/// 顺序即优先级：Wayland 会话必须优先，因为在同一台机器上 `DISPLAY` 与
/// `WAYLAND_DISPLAY` 可能同时存在（XWayland），选错后端会让输入落到 X11 客户端上，
/// 而原生 Wayland 应用完全收不到——这是最难排查的一类故障。
pub fn select_backend() -> Result<Arc<dyn SurfaceBackend>, BackendError> {
    #[cfg(target_os = "linux")]
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let has_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        if has_wayland || session == "wayland" {
            return Ok(Arc::new(linux_wayland::WaylandBackend::probe()?));
        }
        if std::env::var_os("DISPLAY").is_some() || session == "x11" {
            return Ok(Arc::new(linux_x11::X11Backend::probe()?));
        }
        return Err(BackendError::unsupported(
            "no Wayland or X11 session detected; headless sessions have no desktop to drive",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        return Ok(Arc::new(win32::Win32Backend::probe()?));
    }

    #[cfg(target_os = "macos")]
    {
        return Ok(Arc::new(darwin::DarwinBackend::probe()?));
    }

    #[allow(unreachable_code)]
    Err(BackendError::unsupported(
        "surface-daemon has no backend for this target",
    ))
}

/// 构造一个"全部不可用"的能力集。
///
/// 每个后端在自己的 `capabilities()` 里基于真实探测覆写字段，
/// 但必须以这个为起点——默认不可用、按证据逐项打开，
/// 比默认可用、按失败逐项关闭安全得多。
pub fn conservative_capability(platform: PlatformId, session: SessionType) -> CapabilitySet {
    let mut perception = std::collections::BTreeMap::new();
    perception.insert(surface_contract::PerceptionSource::A11y, PrimitiveState::Unavailable);
    perception.insert(surface_contract::PerceptionSource::Ocr, PrimitiveState::Unavailable);
    perception.insert(surface_contract::PerceptionSource::Dom, PrimitiveState::Unavailable);
    perception.insert(surface_contract::PerceptionSource::Vision, PrimitiveState::Unavailable);

    let mut grants = std::collections::BTreeMap::new();
    for scope in [
        AccessScope::Accessibility,
        AccessScope::ScreenRecording,
        AccessScope::InputMonitoring,
        AccessScope::Automation,
        AccessScope::PortalScreencast,
        AccessScope::PortalRemotedesktop,
    ] {
        grants.insert(scope, GrantState::Unknown);
    }

    CapabilitySet {
        platform,
        session_type: session,
        perception,
        primitives: Primitives {
            pointer: false,
            keyboard: false,
            semantic: false,
            capture: false,
            clipboard_read: false,
            window_enumerate: false,
            background_input: false,
        },
        grants,
        notes: vec!["capability set not probed yet".to_string()],
    }
}
