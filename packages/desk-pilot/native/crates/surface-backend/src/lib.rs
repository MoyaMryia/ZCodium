//! 平台后端端口与错误类型。
//!
//! `SurfaceBackend` 与 TS 侧 `packages/desk-pilot/src/contract.ts` 的 `SurfaceAdapter`
//! 一一对应，**恰好 12 个方法**——这是架构策略 `maxPublicMethods: 12` 的原生侧镜像。
//! 方法按输入通道收敛（语义 / 指针 / 文本 / 按键 / 剪贴板），新增手势只扩联合类型，不加方法。
//!
//! trait 是同步的：daemon 用 `tokio::task::spawn_blocking` 包一层，
//! 比 `async fn in trait` 少一层装箱，也让后端可以安全地持有非 `Send` 的平台句柄。

use surface_contract::*;

/// 后端错误。
///
/// `possibly_sent` 必须由后端如实填写：已下达到平台的失败是 `true`，
/// 参数校验阶段失败是 `false`。host 侧靠它决定补救方式，谎报会让 agent 重复破坏。
#[derive(Debug, Clone, thiserror::Error)]
#[error("{code:?}: {message}")]
pub struct BackendError {
    pub code: DeskErrorCode,
    pub message: String,
    pub possibly_sent: bool,
    pub recovery: Option<String>,
}

impl BackendError {
    pub fn new(code: DeskErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            possibly_sent: false,
            recovery: None,
        }
    }

    /// 平台或当前授权状态下不支持该原语。
    ///
    /// 这是**唯一**允许表达"做不到"的方式。后端不允许静默降级、不允许返回伪造的成功。
    pub fn unsupported(what: impl Into<String>) -> Self {
        let what = what.into();
        Self {
            code: DeskErrorCode::UnsupportedOnPlatform,
            message: format!("unsupported on this platform/session: {what}"),
            possibly_sent: false,
            recovery: Some(
                "Call capabilities and pick a primitive this platform reports as available."
                    .to_string(),
            ),
        }
    }

    /// 授权缺失。`request_access` 会说明缺哪一项。
    pub fn permission_denied(scope: AccessScope) -> Self {
        Self {
            code: DeskErrorCode::PermissionDenied,
            message: format!("missing grant: {scope:?}"),
            possibly_sent: false,
            recovery: Some(format!(
                "Call request_access with scope {scope:?} and follow the remediation."
            )),
        }
    }

    pub fn invalid_argument(message: impl Into<String>) -> Self {
        Self::new(DeskErrorCode::InvalidArgument, message)
    }

    pub fn stale_ref(message: impl Into<String>) -> Self {
        Self {
            code: DeskErrorCode::StaleRef,
            message: message.into(),
            possibly_sent: false,
            recovery: Some("Call observe again and re-pick the index from the fresh UiMap.".to_string()),
        }
    }

    /// 骨架阶段的占位错误：接口已定义，实现尚未落地。
    pub fn not_implemented(feature: &str) -> Self {
        Self {
            code: DeskErrorCode::UnsupportedOnPlatform,
            message: format!("{feature} is declared but not implemented yet"),
            possibly_sent: false,
            recovery: Some(
                "Track the remaining implementation phases in .agents/specs/desk-pilot.md."
                    .to_string(),
            ),
        }
    }

    /// 指令已下达平台之后才失败。
    pub fn sent(code: DeskErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            possibly_sent: true,
            recovery: None,
        }
    }
}

/// 平台后端端口。12 个方法，与 TS `SurfaceAdapter` 对齐。
pub trait SurfaceBackend: Send + Sync {
    /// 启动时调用一次。返回的能力集由 host 冻结。
    fn capabilities(&self) -> Result<CapabilitySet, BackendError>;

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError>;

    fn observe(&self, request: &ObserveRequest) -> Result<UiMap, BackendError>;

    /// 句柄过期返回 `Ok(None)`，由 host 转成 `STALE_REF`。
    fn inspect(&self, handle: &ElementHandle) -> Result<Option<UiElement>, BackendError>;

    fn semantic(&self, request: &SemanticRequest) -> Result<ActuationOutcome, BackendError>;

    fn pointer(&self, request: &PointerRequest) -> Result<ActuationOutcome, BackendError>;

    fn text(&self, request: &TextRequest) -> Result<ActuationOutcome, BackendError>;

    fn key(&self, chord: &KeyChord) -> Result<ActuationOutcome, BackendError>;

    fn clipboard(&self, op: &ClipboardOp) -> Result<ClipboardResult, BackendError>;

    fn attach_cdp(&self, request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError>;

    /// 只报告授权状态，不尝试自动提权。
    fn request_access(&self, scope: AccessScope) -> Result<AccessReport, BackendError>;

    /// 幂等。
    fn shutdown(&self) -> Result<(), BackendError>;
}

/// 后端不缓存任何平台状态；这个关联类型只用于把"观测缓存"的所有权留在 host 侧。
pub type BackendResult<T> = Result<T, BackendError>;
