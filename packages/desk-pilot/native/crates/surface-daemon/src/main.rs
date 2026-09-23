//! surface-daemon：DeskPilot 的原生执行进程。
//!
//! 职责边界（见 `.agents/specs/desk-pilot.md`）：
//! - **唯一碰 FFI 的地方**。平台差异全部收在 `surface-backend` 的四个后端里；
//! - **无业务状态**。不缓存窗口列表、不缓存能力集、不缓存剪贴板；
//! - **不做策略**。授权闸门、动作租约、kill switch 都在 TS 侧；
//!   这里只回报平台事实（granted/denied/unknown）。
//!
//! 传输：Unix domain socket（macOS/Linux）或 Windows named pipe，
//! 一请求一响应的 JSON 行协议，与现有 `cua-broker` 的形状一致但前缀不同，互不抢占。

mod dispatch;
mod lifecycle;
mod server;

use std::sync::Arc;

use surface_backend::SurfaceBackend;
use surface_contract::{DeskRequest, DeskResponse, DESK_IPC_VERSION};

pub use lifecycle::{DaemonConfig, DaemonHandle};

#[tokio::main]
async fn main() -> std::io::Result<()> {
    lifecycle::init_tracing();

    let config = match lifecycle::DaemonConfig::from_env() {
        Ok(config) => config,
        Err(message) => {
            eprintln!("surface-daemon: {message}");
            std::process::exit(2);
        }
    };

    // 后端探测失败也要起来：host 需要一个能回报"做不到"的进程，
    // 而不是一个连不上的端口。
    let backend: Arc<dyn SurfaceBackend> = match surface_backend::backends::select_backend() {
        Ok(backend) => backend,
        Err(error) => {
            tracing::warn!(%error, "no backend selected; serving an all-disabled capability set");
            Arc::new(dispatch::DisabledBackend::new(error))
        }
    };

    let capability = match backend.capabilities() {
        Ok(capability) => capability,
        Err(error) => {
            eprintln!("surface-daemon: capability probe failed: {error}");
            std::process::exit(3);
        }
    };
    tracing::info!(
        ipc_version = DESK_IPC_VERSION,
        ?capability,
        "surface-daemon ready"
    );

    let handle = lifecycle::spawn_liveness_watchdog(config.launcher_pid);
    server::serve(config, backend, handle).await
}

/// 供测试与二进制内复用的响应构造，避免每个分支手写 JSON。
pub fn response_for(request: &DeskRequest, response: DeskResponse) -> DeskResponse {
    DeskResponse {
        id: request.id.clone(),
        ..response
    }
}
