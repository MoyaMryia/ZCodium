//! 方法分发。
//!
//! 12 个方法名与 TS 侧 `SurfaceAdapter` 严格对齐。未知方法一律
//! `PROTOCOL_VIOLATION`——不允许把未知方法当作 no-op 成功返回，
//! 那会让 host 以为一个不存在的动作生效了。

use std::sync::Arc;

use surface_backend::{BackendError, SurfaceBackend};
use surface_contract::{
    AccessReport, AccessScope, ActuationOutcome, CapabilitySet, CdpAttachRequest, CdpEndpoint,
    ClipboardOp, ClipboardResult, DeskErrorCode, DeskRequest, DeskResponse, ElementHandle,
    KeyChord, ObserveRequest, PointerRequest, SemanticRequest, SurfaceSummary, TextRequest,
    UiElement, UiMap,
};

/// 后端探测失败时的占位后端：能力全关，一切执行返回 `UNSUPPORTED_ON_PLATFORM`。
pub struct DisabledBackend {
    reason: String,
}

impl DisabledBackend {
    pub fn new(error: BackendError) -> Self {
        Self {
            reason: error.to_string(),
        }
    }
}

impl SurfaceBackend for DisabledBackend {
    fn capabilities(&self) -> Result<CapabilitySet, BackendError> {
        let mut capability =
            surface_backend::backends::conservative_capability(default_platform(), default_session());
        capability.notes = vec![format!("backend unavailable: {}", self.reason)];
        Ok(capability)
    }

    fn surfaces(&self) -> Result<Vec<SurfaceSummary>, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn observe(&self, _request: &ObserveRequest) -> Result<UiMap, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn inspect(&self, _handle: &ElementHandle) -> Result<Option<UiElement>, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn semantic(&self, _request: &SemanticRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn pointer(&self, _request: &PointerRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn text(&self, _request: &TextRequest) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn key(&self, _chord: &KeyChord) -> Result<ActuationOutcome, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn clipboard(&self, _op: &ClipboardOp) -> Result<ClipboardResult, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn attach_cdp(&self, _request: &CdpAttachRequest) -> Result<CdpEndpoint, BackendError> {
        Err(BackendError::unsupported("no backend is available"))
    }

    fn request_access(&self, scope: AccessScope) -> Result<AccessReport, BackendError> {
        Ok(AccessReport {
            scope,
            state: surface_contract::GrantState::Unknown,
            remediation: Some("No backend is available; install a supported desktop session.".to_string()),
        })
    }

    fn shutdown(&self) -> Result<(), BackendError> {
        Ok(())
    }
}

fn default_platform() -> surface_contract::PlatformId {
    if cfg!(target_os = "windows") {
        surface_contract::PlatformId::Win32
    } else if cfg!(target_os = "macos") {
        surface_contract::PlatformId::Darwin
    } else if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        surface_contract::PlatformId::LinuxWayland
    } else {
        surface_contract::PlatformId::LinuxX11
    }
}

fn default_session() -> surface_contract::SessionType {
    match default_platform() {
        surface_contract::PlatformId::LinuxWayland => surface_contract::SessionType::Wayland,
        surface_contract::PlatformId::LinuxX11 => surface_contract::SessionType::X11,
        _ => surface_contract::SessionType::Native,
    }
}

/// 把一个请求变成一个响应。永不 panic：任何内部错误都归一成带错误码的响应。
pub fn handle(backend: &Arc<dyn SurfaceBackend>, request: &DeskRequest) -> DeskResponse {
    let result = match request.method.as_str() {
        "capabilities" => serialize(backend.capabilities()),
        "surfaces" => serialize(backend.surfaces()),
        "observe" => parse::<ObserveRequest>(&request.input)
            .and_then(|input| serialize(backend.observe(&input))),
        "inspect" => parse::<ElementHandle>(&request.input)
            .and_then(|handle| serialize(backend.inspect(&handle))),
        "semantic" => parse::<SemanticRequest>(&request.input)
            .and_then(|input| serialize(backend.semantic(&input))),
        "pointer" => parse::<PointerRequest>(&request.input)
            .and_then(|input| serialize(backend.pointer(&input))),
        "text" => {
            parse::<TextRequest>(&request.input).and_then(|input| serialize(backend.text(&input)))
        }
        "key" => parse::<KeyChord>(&request.input).and_then(|chord| serialize(backend.key(&chord))),
        "clipboard" => {
            parse::<ClipboardOp>(&request.input).and_then(|op| serialize(backend.clipboard(&op)))
        }
        "attach_cdp" => parse::<CdpAttachRequest>(&request.input)
            .and_then(|input| serialize(backend.attach_cdp(&input))),
        "request_access" => parse::<AccessScope>(&request.input)
            .and_then(|scope| serialize(backend.request_access(scope))),
        "shutdown" => serialize(backend.shutdown()),
        other => Err(BackendError::new(
            DeskErrorCode::ProtocolViolation,
            format!("unknown method: {other}"),
        )),
    };

    match result {
        Ok(value) => DeskResponse::ok(request.id.clone(), value),
        Err(error) => {
            let mut response = DeskResponse::error(
                request.id.clone(),
                error.code,
                error.message.clone(),
            );
            response.possibly_sent = error.possibly_sent;
            response.recovery = error.recovery.clone();
            response
        }
    }
}

fn parse<T: serde::de::DeserializeOwned>(input: &serde_json::Value) -> Result<T, BackendError> {
    serde_json::from_value(input.clone()).map_err(|error| {
        BackendError::invalid_argument(format!("invalid input payload: {error}"))
    })
}

fn serialize<T: serde::Serialize>(value: Result<T, BackendError>) -> Result<serde_json::Value, BackendError> {
    value.and_then(|value| {
        serde_json::to_value(value)
            .map_err(|error| BackendError::new(DeskErrorCode::ProtocolViolation, error.to_string()))
    })
}
