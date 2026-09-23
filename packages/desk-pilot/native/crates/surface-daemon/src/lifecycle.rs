//! 生命周期：配置、看门狗、优雅停止。
//!
//! 与闭源 Helper 的一个关键差异：这里**没有**安装锁/租约/签名校验那一整套。
//! 那些属于"分发一个需要被信任的第三方二进制"的问题；surface-daemon 由 ZCode 自己
//! 构建、自己拉起，信任边界在进程边界上，不需要在运行时再证明一次自己是自己。
//! 授权闸门、动作租约、kill switch 都在 TS 侧，见 `.agents/specs/desk-pilot.md` 安全模型。

use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::watch;

/// 默认空闲退出。宿主崩溃时 daemon 不该变成孤儿进程一直占着桌面控制权。
pub const DEFAULT_IDLE_EXIT: Duration = Duration::from_secs(15 * 60);

/// launcher 看门狗轮询间隔。
const WATCHDOG_INTERVAL: Duration = Duration::from_secs(5);

pub struct DaemonConfig {
    /// Unix socket 路径；Windows 上是 named pipe 名。
    pub socket_path: PathBuf,
    /// 拉起 daemon 的宿主 pid。宿主消失即自杀。
    pub launcher_pid: Option<u32>,
    /// 空闲多久没有请求就退出。
    pub idle_exit: Duration,
}

impl DaemonConfig {
    /// 从环境变量读取配置。
    ///
    /// - `DESK_PILOT_SOCKET`：socket 路径（必填）
    /// - `DESK_PILOT_LAUNCHER_PID`：宿主 pid（可选）
    /// - `DESK_PILOT_IDLE_EXIT_MS`：空闲退出毫秒数（可选）
    pub fn from_env() -> Result<Self, String> {
        let raw = std::env::var("DESK_PILOT_SOCKET")
            .map_err(|_| "DESK_PILOT_SOCKET is required".to_string())?;
        let socket_path = PathBuf::from(raw);
        if socket_path.as_os_str().is_empty() {
            return Err("DESK_PILOT_SOCKET must not be empty".to_string());
        }
        // 未展开的 $VAR 会让 daemon 在一个意外路径上监听，host 永远连不上，
        // 而错误表现是"连不上"而不是"配置错"。
        let display = socket_path.to_string_lossy();
        if display.contains("${") || display.contains("$VAR") {
            return Err(format!("DESK_PILOT_SOCKET has an unexpanded placeholder: {display}"));
        }

        let launcher_pid = std::env::var("DESK_PILOT_LAUNCHER_PID")
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok())
            .filter(|pid| *pid > 0);

        let idle_exit = std::env::var("DESK_PILOT_IDLE_EXIT_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok())
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_IDLE_EXIT);

        Ok(Self {
            socket_path,
            launcher_pid,
            idle_exit,
        })
    }
}

/// daemon 句柄：ready 标记 + 停止信号 + launcher 看门狗。
pub struct DaemonHandle {
    stop_tx: tokio::sync::watch::Sender<bool>,
    stop_rx: tokio::sync::watch::Receiver<bool>,
    ready: std::sync::Arc<std::sync::atomic::AtomicBool>,
    watchdog: Option<tokio::task::JoinHandle<()>>,
}

impl DaemonHandle {
    pub fn new() -> Self {
        let (stop_tx, stop_rx) = tokio::sync::watch::channel(false);
        Self {
            stop_tx,
            stop_rx,
            ready: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            watchdog: None,
        }
    }

    pub fn stop_signal(&self) -> tokio::sync::watch::Receiver<bool> {
        self.stop_rx.clone()
    }

    pub fn mark_ready(&self) {
        self.ready
            .store(true, std::sync::atomic::Ordering::Release);
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(std::sync::atomic::Ordering::Acquire)
    }

    pub fn is_stopping(&self) -> bool {
        *self.stop_rx.borrow()
    }

    /// 请求停止。幂等。
    pub fn request_stop(&self) {
        let _ = self.stop_tx.send(true);
    }

    /// 挂上 launcher 看门狗任务。
    pub fn attach_watchdog(&mut self, launcher_pid: Option<u32>) {
        let Some(launcher_pid) = launcher_pid else {
            return;
        };
        let stop_tx = self.stop_tx.clone();
        self.watchdog = Some(tokio::spawn(async move {
            loop {
                tokio::time::sleep(WATCHDOG_INTERVAL).await;
                if !is_process_alive(launcher_pid) {
                    tracing::info!(launcher_pid, "launcher is gone; stopping");
                    let _ = stop_tx.send(true);
                    return;
                }
            }
        }));
    }

    /// 等看门狗结束。用于测试与优雅退出。
    pub async fn join_watchdog(&mut self) {
        if let Some(handle) = self.watchdog.take() {
            let _ = handle.await;
        }
    }
}

impl Default for DaemonHandle {
    fn default() -> Self {
        Self::new()
    }
}

/// 拉起 launcher 看门狗。
pub fn spawn_liveness_watchdog(launcher_pid: Option<u32>) -> DaemonHandle {
    let mut handle = DaemonHandle::new();
    handle.attach_watchdog(launcher_pid);
    handle
}

/// `kill(pid, 0)` 语义。EPERM 说明进程存在但不属于我们，仍然算活着。
fn is_process_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: libc::kill 只发 0 号信号，不产生副作用。
        let result = unsafe { libc_kill(pid as i32, 0) };
        result == 0 || last_errno() == errno_eperm()
    }
    #[cfg(not(unix))]
    {
        // Windows 上 OpenProcess 失败即视为不存在；骨架阶段不引入 windows crate 的进程 API。
        let _ = pid;
        true
    }
}

#[cfg(unix)]
fn last_errno() -> i32 {
    unsafe { *libc_errno_location() }
}

#[cfg(unix)]
extern "C" {
    #[link_name = "kill"]
    fn libc_kill(pid: i32, signal: i32) -> i32;
    #[link_name = "__errno_location"]
    fn libc_errno_location() -> *mut i32;
}

#[cfg(unix)]
fn errno_eperm() -> i32 {
    1
}

pub fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_env("DESK_PILOT_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();
}
