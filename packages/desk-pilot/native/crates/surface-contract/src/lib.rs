//! DeskPilot 原生契约（Rust 侧）。
//!
//! 只放数据类型与线协议信封；平台代码在 `surface-backend`，进程与传输在 `surface-daemon`。

pub mod actuation;
pub mod errors;
pub mod ui_map;

pub use actuation::{
    ActionTarget, ActuationEnvelope, ActuationOutcome, CdpAttachRequest, CdpEndpoint, ClipboardOp,
    ClipboardResult, Expectation, KeyChord, KeyModifier, PointerButton, PointerGesture,
    PointerRequest, SemanticRequest, TextOp, TextRange, TextRequest, Verification,
};
pub use errors::{
    AccessReport, AccessScope, CapabilitySet, DeskErrorCode, DeskRequest, DeskResponse, GrantState,
    PrimitiveState, Primitives, RequestContext, SessionType, DESK_METHODS,
};
pub use ui_map::{
    Bounds, ElementFlag, ElementHandle, ElementKind, ElementProvenance, FrameBinding,
    ObserveRequest, PerceptionSource, PlatformId, SurfaceRef, SurfaceSummary, UiElement, UiMap,
    DESK_IPC_VERSION, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES,
};
