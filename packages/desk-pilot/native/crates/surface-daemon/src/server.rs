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
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use crate::lifecycle::DaemonHandle;

/// 起服务。
///
/// 传输层按平台分叉：Unix 上是 domain socket，Windows 上是 named pipe。
/// 两侧只有"拿到一个已连接的流"不同，行协议本身完全共用，所以连接处理是泛型的。
pub async fn serve(
    config: crate::lifecycle::DaemonConfig,
    backend: Arc<dyn SurfaceBackend>,
    handle: DaemonHandle,
) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        serve_unix_socket(config, backend, handle).await
    }
    #[cfg(windows)]
    {
        serve_named_pipe(config, backend, handle).await
    }
}

/// Unix domain socket 传输。
#[cfg(unix)]
async fn serve_unix_socket(
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

    let listener = tokio::net::UnixListener::bind(&socket_path)?;
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

/// Windows named pipe 传输。
///
/// pipe 名由 `socket_path` 派生：host 传一个 `\\.\pipe\desk-pilot-<hash>` 形状的路径，
/// daemon 直接用它；传普通路径时退化为 `desk-pilot-<文件名>`，避免两种调用方都要改。
///
/// **已验证范围**：只在 Linux 上编译验证过（`cargo check --target
/// x86_64-pc-windows-msvc`）。Windows 上的运行时行为尚未验证，首次真机跑通前
/// 不要认为这条路径是过的。
#[cfg(windows)]
async fn serve_named_pipe(
    config: crate::lifecycle::DaemonConfig,
    backend: Arc<dyn SurfaceBackend>,
    handle: DaemonHandle,
) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    let pipe_name = pipe_name_for(&config.socket_path);
    let mut listener = ServerOptions::new().create(&pipe_name)?;

    tracing::info!(pipe = %pipe_name, "listening");
    handle.mark_ready();

    loop {
        if handle.is_stopping() {
            break;
        }
        // named pipe 是单客户端语义：必须在 accept 之前先把下一个实例建好，
        // 否则并发连接会被系统直接拒绝而不是排队。
        let next = ServerOptions::new().create(&pipe_name)?;
        if let Err(error) = listener.connect().await {
            tracing::warn!(%error, "pipe connect failed");
            listener = next;
            continue;
        }
        let stream = std::mem::replace(&mut listener, next);
        let backend = Arc::clone(&backend);
        let stop = handle.stop_signal();
        tokio::spawn(async move {
            if let Err(error) = serve_connection(stream, backend, stop).await {
                tracing::debug!(%error, "connection ended");
            }
        });
    }

    tracing::info!("surface-daemon stopped");
    Ok(())
}

/// 行协议连接处理。与传输无关：Unix socket 与 named pipe 都走这里。
async fn serve_connection<S>(
    stream: S,
    backend: Arc<dyn SurfaceBackend>,
    mut stop: tokio::sync::watch::Receiver<bool>,
) -> std::io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    // 泛型 S 没有 into_split()（那是 UnixStream/XxxStream 的特有方法）；
    // tokio::io::split 对任何 AsyncRead + AsyncWrite 都成立，两侧传输都能用。
    let (reader, mut writer) = tokio::io::split(stream);
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
            Ok(request) => crate::dispatch::handle(&backend, &request),
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

async fn write_response<W>(writer: &mut W, response: &DeskResponse) -> std::io::Result<()>
where
    W: AsyncWrite + Unpin,
{
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

/// Windows 上 named pipe 自带 ACL，不需要这一步；保留函数是为了让两个平台的
/// `serve_*` 形状一致。加 allow(dead_code) 是因为 Windows 路径没人调用它。
#[cfg(not(unix))]
#[allow(dead_code)]
fn restrict_socket_permissions(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

/// Windows named pipe 的名字前缀。与 host 侧约定一致，改这里必须同步 TS。
#[cfg(windows)]
const PIPE_PREFIX: &str = r"\\.\pipe\desk-pilot-";

/// Windows 上 named pipe 的名字派生。
///
/// host 可以直接传 `\\.\pipe\desk-pilot-xxx`（推荐，语义明确），
/// 也可以传一个普通路径——此时用文件名部分拼一个稳定的 pipe 名，
/// 这样同一套 `DESK_PILOT_SOCKET` 配置在三个平台上都不用改。
#[cfg(windows)]
fn pipe_name_for(socket_path: &std::path::Path) -> String {
    let raw = socket_path.to_string_lossy();
    if raw.starts_with("\\\\\\.\\pipe\\") {
        return raw.into_owned();
    }
    let stem = socket_path
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "desk-pilot".to_string());
    format!("{PIPE_PREFIX}{stem}")
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
    serde_json::to_string(&crate::dispatch::handle(backend, &request)).unwrap_or_default()
}
