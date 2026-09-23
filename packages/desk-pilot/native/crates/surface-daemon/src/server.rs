//! JSON 行协议服务端。
//!
//! 与 `node-repl-host` 的 broker 约定一致：
//! - 一请求一响应，`\n` 分隔；
//! - 单条请求上限 `MAX_REQUEST_BYTES`，超出直接断开而不是尝试解析；
//! - 单条响应上限 `MAX_RESPONSE_BYTES`，超出按 `PROTOCOL_VIOLATION` 回报；
//! - token 用 `timingSafeEqual` 语义的常量时间比较在 **TS 侧**做，
//!   这里只把 token 原样转交后端之外的鉴权层，daemon 自己不再鉴一次。

use std::sync::Arc;

use surface_backend::SurfaceBackend;
use surface_contract::{
    DeskErrorCode, DeskRequest, DeskResponse, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::lifecycle::DaemonHandle;

/// 起服务。socket 路径由 `DaemonConfig` 给出；已存在的 stale socket 先清理。
pub async fn serve(
    config: crate::lifecycle::DaemonConfig,
    backend: Arc<dyn SurfaceBackend>,
    handle: DaemonHandle,
) -> std::io::Result<()> {
    let socket_path = config.socket_path.clone();
    if socket_path.exists() {
        // stale socket：上一次异常退出留下的。删掉重来，不要让 host 连到一个死端点。
        std::fs::remove_file(&socket_path)?;
    }
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let listener = UnixListener::bind(&socket_path)?;
    // 只允许同一用户访问。桌面控制权等同于用户本人的权限，不能留给别的用户。
    restrict_socket_permissions(&socket_path)?;

    tracing::info!(path = %socket_path.display(), "listening");
    handle.mark_ready();

    loop {
        if handle.is_stopping() {
            break;
        }
        let (stream, _addr) = match listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                tracing::warn!(%error, "accept failed");
                continue;
            }
        };
        let backend = Arc::clone(&backend);
        let stop = handle.stop_signal();
        tokio::spawn(async move {
            if let Err(error) = serve_connection(stream, backend, stop).await {
                tracing::debug!(%error, "connection ended");
            }
        });
    }

    drop(listener);
    let _ = std::fs::remove_file(&socket_path);
    tracing::info!("surface-daemon stopped");
    Ok(())
}

async fn serve_connection(
    stream: UnixStream,
    backend: Arc<dyn SurfaceBackend>,
    mut stop: tokio::sync::watch::Receiver<bool>,
) -> std::io::Result<()> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();

    loop {
        let line = tokio::select! {
            biased;
            changed = stop.changed() => {
                if changed.is_ok() && *stop.borrow() {
                    return Ok(());
                }
                continue;
            }
            next = lines.next_line() => next?,
        };

        let Some(line) = line else {
            return Ok(());
        };
        if line.len() > MAX_REQUEST_BYTES {
            let response = DeskResponse::error(
                "unknown",
                DeskErrorCode::ProtocolViolation,
                format!("request exceeds {MAX_REQUEST_BYTES} bytes"),
            );
            write_response(&mut writer, &response).await?;
            return Ok(());
        }

        let response = match serde_json::from_str::<DeskRequest>(&line) {
            Ok(request) => dispatch::handle(&backend, &request),
            Err(error) => DeskResponse::error(
                "unknown",
                DeskErrorCode::ProtocolViolation,
                format!("malformed request: {error}"),
            ),
        };

        let payload = serde_json::to_vec(&response)?;
        if payload.len() > MAX_RESPONSE_BYTES {
            let oversized = DeskResponse::error(
                response.id.clone(),
                DeskErrorCode::ProtocolViolation,
                format!("response exceeds {MAX_RESPONSE_BYTES} bytes"),
            );
            write_response(&mut writer, &oversized).await?;
            continue;
        }
        write_response(&mut writer, &response).await?;
    }
}

async fn write_response(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    response: &DeskResponse,
) -> std::io::Result<()> {
    let mut payload = serde_json::to_vec(response)?;
    payload.push(b'\n');
    writer.write_all(&payload).await?;
    writer.flush().await?;
    Ok(())
}

#[cfg(unix)]
fn restrict_socket_permissions(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_socket_permissions(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Windows 上 named pipe 的等价物。骨架阶段保留形状，实现在 P2 落地。
#[cfg(windows)]
pub mod named_pipe {
    pub const PIPE_PREFIX: &str = "\\\\.\\pipe\\desk-pilot-";
}

/// 供测试复用：把一次请求走完 dispatch 并序列化响应。
#[allow(dead_code)]
pub async fn round_trip(backend: &Arc<dyn SurfaceBackend>, line: &str) -> String {
    let request: DeskRequest = match serde_json::from_str(line) {
        Ok(request) => request,
        Err(error) => {
            return serde_json::to_string(&DeskResponse::error(
                "unknown",
                DeskErrorCode::ProtocolViolation,
                format!("malformed request: {error}"),
            ))
            .unwrap_or_default();
        }
    };
    serde_json::to_string(&dispatch::handle(backend, &request)).unwrap_or_default()
}
