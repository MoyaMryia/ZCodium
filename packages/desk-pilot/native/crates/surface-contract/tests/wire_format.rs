//! 线格式守卫：Rust 侧的 JSON 必须和 `packages/desk-pilot/src/*.ts` 逐字段一致。
//!
//! 为什么需要这个文件：TS 用 camelCase，Rust 结构体默认输出 snake_case。
//! 两者不一致时**编译期完全没有信号**，只在 host 反序列化 daemon 响应时才炸，
//! 而且表现是 `PROTOCOL_VIOLATION` 这种离根因很远的错误。spec 里
//! "任何一侧新增字段都必须同步另一侧"这条约束，靠的就是这里的断言。
//!
//! 规则（改这条规则前先读 `ui_map.rs` 模块文档）：
//! - 结构体字段：camelCase；
//! - 枚举 tag 值：snake_case；
//! - `PlatformId`：kebab-case（TS 写的是 `linux-x11` / `linux-wayland`）；
//! - `ref_` 序列化为 `ref`。

use serde_json::{json, Value};
use surface_contract::*;

/// 序列化后必须出现的 key。漏一个就说明某天有人加了字段却没同步 TS。
#[test]
fn struct_field_names_are_camel_case() {
    let element_value = UiElement {
        ref_: "@s1:e0".to_string(),
        kind: ElementKind::Button,
        name: "OK".to_string(),
        value: None,
        bounds: Some(Bounds {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        }),
        flags: vec![ElementFlag::Secure],
        actions: vec!["press".to_string()],
        provenance: ElementProvenance {
            source: PerceptionSource::A11y,
            confidence: 1.0,
            observed_at_ms: 42,
            fingerprint: "button@OK@/root".to_string(),
        },
    };
    let element: Value = serde_json::to_value(&element_value).expect("serialize UiElement");

    for key in [
        "ref",
        "kind",
        "name",
        "value",
        "bounds",
        "flags",
        "actions",
        "provenance",
    ] {
        assert!(
            element.get(key).is_some(),
            "UiElement missing `{key}`: {element}"
        );
    }
    assert!(
        element.get("ref_").is_none(),
        "UiElement must not emit `ref_`"
    );
    let provenance = &element["provenance"];
    for key in ["source", "confidence", "observedAtMs", "fingerprint"] {
        assert!(
            provenance.get(key).is_some(),
            "ElementProvenance missing `{key}`: {provenance}"
        );
    }

    let ui_map: Value = serde_json::to_value(UiMap {
        snapshot_id: "s1".to_string(),
        surface: SurfaceRef {
            pid: 7,
            bundle_id: Some("dev.zcodium.app".to_string()),
            name: "ZCodium".to_string(),
            window_id: Some(9),
        },
        frame: FrameBinding {
            frame_id: "f1".to_string(),
            width_px: 800,
            height_px: 600,
            scale_factor: 2.0,
            captured_at_ms: 1,
        },
        source_mix: Default::default(),
        truncated: false,
        truncated_at_depth: None,
        elements: vec![element_value],
    })
    .expect("serialize UiMap");

    for key in [
        "snapshotId",
        "surface",
        "frame",
        "sourceMix",
        "truncated",
        "truncatedAtDepth",
        "elements",
    ] {
        assert!(ui_map.get(key).is_some(), "UiMap missing `{key}`: {ui_map}");
    }
    for key in ["pid", "bundleId", "name", "windowId"] {
        assert!(
            ui_map["surface"].get(key).is_some(),
            "SurfaceRef missing `{key}`: {}",
            ui_map["surface"]
        );
    }
    for key in [
        "frameId",
        "widthPx",
        "heightPx",
        "scaleFactor",
        "capturedAtMs",
    ] {
        assert!(
            ui_map["frame"].get(key).is_some(),
            "FrameBinding missing `{key}`: {}",
            ui_map["frame"]
        );
    }

    let summary: Value = serde_json::to_value(SurfaceSummary {
        surface: serde_json::from_value(ui_map["surface"].clone()).expect("SurfaceRef"),
        title: "t".to_string(),
        main: true,
        focused: false,
        on_screen: true,
        bounds: None,
    })
    .expect("serialize SurfaceSummary");
    assert!(
        summary.get("onScreen").is_some(),
        "SurfaceSummary missing `onScreen`: {summary}"
    );

    let observe: Value = serde_json::to_value(ObserveRequest {
        surface: serde_json::from_value(ui_map["surface"].clone()).expect("SurfaceRef"),
        depth: Some(3),
        include_raster: true,
    })
    .expect("serialize ObserveRequest");
    assert!(
        observe.get("includeRaster").is_some(),
        "ObserveRequest missing `includeRaster`: {observe}"
    );

    let handle: Value = serde_json::to_value(ElementHandle {
        snapshot_id: "s1".to_string(),
        ref_: "@s1:e0".to_string(),
    })
    .expect("serialize ElementHandle");
    for key in ["snapshotId", "ref"] {
        assert!(
            handle.get(key).is_some(),
            "ElementHandle missing `{key}`: {handle}"
        );
    }
}

#[test]
fn capability_set_field_names_are_camel_case() {
    let capability: Value = serde_json::to_value(CapabilitySet {
        platform: PlatformId::LinuxWayland,
        session_type: SessionType::Wayland,
        perception: Default::default(),
        primitives: Primitives {
            pointer: true,
            keyboard: true,
            semantic: true,
            capture: false,
            clipboard_read: true,
            window_enumerate: true,
            background_input: false,
        },
        grants: Default::default(),
        notes: vec![],
    })
    .expect("serialize CapabilitySet");

    for key in [
        "platform",
        "sessionType",
        "perception",
        "primitives",
        "grants",
        "notes",
    ] {
        assert!(
            capability.get(key).is_some(),
            "CapabilitySet missing `{key}`: {capability}"
        );
    }
    for key in [
        "pointer",
        "keyboard",
        "semantic",
        "capture",
        "clipboardRead",
        "windowEnumerate",
        "backgroundInput",
    ] {
        assert!(
            capability["primitives"].get(key).is_some(),
            "Primitives missing `{key}`: {}",
            capability["primitives"]
        );
    }

    let context: Value = serde_json::to_value(RequestContext {
        session_id: Some("s".to_string()),
        workspace_key: Some("w".to_string()),
        agent_id: Some("a".to_string()),
        lease_id: Some("l".to_string()),
        runtime_scope: Some("r".to_string()),
    })
    .expect("serialize RequestContext");
    for key in [
        "sessionId",
        "workspaceKey",
        "agentId",
        "leaseId",
        "runtimeScope",
    ] {
        assert!(
            context.get(key).is_some(),
            "RequestContext missing `{key}`: {context}"
        );
    }

    // 全字段填满，才能把 7 个 key 一次看全；ok/error 两个构造函数都带
    // skip_serializing_if，空值字段会被省略，单独测看不到名字。
    let response: Value = serde_json::to_value(DeskResponse {
        id: "1".to_string(),
        ok: false,
        result: Some(json!({})),
        error: Some("boom".to_string()),
        code: Some(DeskErrorCode::Deviation),
        possibly_sent: true,
        recovery: Some("re-observe and retry".to_string()),
    })
    .expect("serialize DeskResponse");
    for key in [
        "id",
        "ok",
        "result",
        "error",
        "code",
        "possiblySent",
        "recovery",
    ] {
        assert!(
            response.get(key).is_some(),
            "DeskResponse missing `{key}`: {response}"
        );
    }
    assert_eq!(response["code"], json!("DEVIATION"));

    // possiblySent = false 时按设计省略，host 侧靠 serde(default) 补回 false。
    let quiet: Value =
        serde_json::to_value(DeskResponse::ok("2", json!({}))).expect("serialize ok response");
    assert_eq!(quiet, json!({"id": "2", "ok": true, "result": {}}));
}

#[test]
fn actuation_field_names_are_camel_case() {
    let target: Value = serde_json::to_value(ActionTarget::Element {
        snapshot_id: "s1".to_string(),
        ref_: "@s1:e0".to_string(),
    })
    .expect("serialize ActionTarget::Element");
    assert_eq!(target["kind"], json!("element"));
    for key in ["snapshotId", "ref"] {
        assert!(
            target.get(key).is_some(),
            "ActionTarget::Element missing `{key}`: {target}"
        );
    }

    let coordinate: Value = serde_json::to_value(ActionTarget::Coordinate {
        frame_id: "f1".to_string(),
        x: 1.0,
        y: 2.0,
    })
    .expect("serialize ActionTarget::Coordinate");
    assert_eq!(coordinate["kind"], json!("coordinate"));
    assert!(
        coordinate.get("frameId").is_some(),
        "ActionTarget::Coordinate missing `frameId`: {coordinate}"
    );

    let scroll: Value = serde_json::to_value(PointerGesture::Scroll {
        delta_x: -3.0,
        delta_y: 4.0,
    })
    .expect("serialize PointerGesture::Scroll");
    assert_eq!(scroll["kind"], json!("scroll"));
    for key in ["deltaX", "deltaY"] {
        assert!(
            scroll.get(key).is_some(),
            "PointerGesture::Scroll missing `{key}`: {scroll}"
        );
    }

    let envelope: Value = serde_json::to_value(ActuationEnvelope {
        target: ActionTarget::Coordinate {
            frame_id: "f1".to_string(),
            x: 0.0,
            y: 0.0,
        },
        expect: Some(Expectation::SurfaceTitleIs {
            surface: SurfaceRef {
                pid: 1,
                bundle_id: None,
                name: "n".to_string(),
                window_id: None,
            },
            title: "hello".to_string(),
        }),
        idempotency_key: Some("k".to_string()),
    })
    .expect("serialize ActuationEnvelope");
    assert!(
        envelope.get("idempotencyKey").is_some(),
        "ActuationEnvelope missing `idempotencyKey`: {envelope}"
    );
    assert_eq!(envelope["expect"]["predicate"], json!("surface_title_is"));
    assert!(
        envelope["expect"].get("title").is_some(),
        "Expectation::SurfaceTitleIs must use `title`: {}",
        envelope["expect"]
    );

    let outcome: Value = serde_json::to_value(ActuationOutcome {
        possibly_sent: true,
        verification: Verification::Deviation {
            expected: "e".to_string(),
            observed: "o".to_string(),
        },
        snapshot_id: Some("s2".to_string()),
    })
    .expect("serialize ActuationOutcome");
    for key in ["possiblySent", "verification", "snapshotId"] {
        assert!(
            outcome.get(key).is_some(),
            "ActuationOutcome missing `{key}`: {outcome}"
        );
    }
    assert_eq!(outcome["verification"]["state"], json!("deviation"));

    let endpoint: Value = serde_json::to_value(CdpEndpoint {
        port: 9222,
        http_endpoint: "http://127.0.0.1:9222".to_string(),
        websocket_url: "ws://127.0.0.1:9222/x".to_string(),
        product: "chrome".to_string(),
    })
    .expect("serialize CdpEndpoint");
    for key in ["port", "httpEndpoint", "websocketUrl", "product"] {
        assert!(
            endpoint.get(key).is_some(),
            "CdpEndpoint missing `{key}`: {endpoint}"
        );
    }
}

/// tag 值与 TS 的字面量联合类型逐一对应。这些字符串是协议的一部分，不能随手改。
#[test]
fn enum_tag_values_match_the_ts_literals() {
    let cases: Vec<(Value, &str)> = vec![
        (
            serde_json::to_value(PlatformId::Win32).expect("platform"),
            "win32",
        ),
        (
            serde_json::to_value(PlatformId::Darwin).expect("platform"),
            "darwin",
        ),
        (
            serde_json::to_value(PlatformId::LinuxX11).expect("platform"),
            "linux-x11",
        ),
        (
            serde_json::to_value(PlatformId::LinuxWayland).expect("platform"),
            "linux-wayland",
        ),
        (
            serde_json::to_value(PerceptionSource::A11y).expect("source"),
            "a11y",
        ),
        (
            serde_json::to_value(PerceptionSource::Ocr).expect("source"),
            "ocr",
        ),
        (
            serde_json::to_value(PerceptionSource::Dom).expect("source"),
            "dom",
        ),
        (
            serde_json::to_value(PerceptionSource::Vision).expect("source"),
            "vision",
        ),
        (
            serde_json::to_value(DeskErrorCode::UnsupportedOnPlatform).expect("code"),
            "UNSUPPORTED_ON_PLATFORM",
        ),
        (
            serde_json::to_value(AccessScope::PortalScreencast).expect("scope"),
            "portal_screencast",
        ),
        (
            serde_json::to_value(AccessScope::PortalRemotedesktop).expect("scope"),
            "portal_remotedesktop",
        ),
        (
            serde_json::to_value(GrantState::NotApplicable).expect("grant"),
            "not_applicable",
        ),
        (
            serde_json::to_value(PrimitiveState::Degraded).expect("state"),
            "degraded",
        ),
        (
            serde_json::to_value(SessionType::Wayland).expect("session"),
            "wayland",
        ),
        (
            serde_json::to_value(PointerButton::Middle).expect("button"),
            "middle",
        ),
        (
            serde_json::to_value(KeyModifier::Cmd).expect("modifier"),
            "cmd",
        ),
        (
            serde_json::to_value(ElementKind::Textfield).expect("kind"),
            "textfield",
        ),
        (
            serde_json::to_value(ElementFlag::HasMenu).expect("flag"),
            "has_menu",
        ),
    ];

    for (value, expected) in cases {
        assert_eq!(
            value,
            json!(expected),
            "serialized {value} but TS declares {expected}"
        );
    }
}

/// 反向验证：按 TS 的字面量形状手写 JSON，必须能反序列化回 Rust 类型。
/// 这一条才是真正防"两侧漂移"的断言——正向序列化只能证明 Rust 自己自洽。
#[test]
fn ts_shaped_json_deserializes() {
    let request: DeskRequest = serde_json::from_value(json!({
        "id": "req-1",
        "token": "t",
        "method": "pointer",
        "input": {
            "target": { "kind": "coordinate", "frameId": "f1", "x": 10, "y": 20 },
            "expect": { "predicate": "element_present",
                        "target": { "kind": "element", "snapshotId": "s1", "ref": "@s1:e0" } },
            "idempotencyKey": "k1",
            "gesture": { "kind": "click", "button": "left", "clicks": 2,
                         "modifiers": ["cmd"] }
        },
        "context": {
            "sessionId": "s", "workspaceKey": "w", "agentId": "a",
            "leaseId": "l", "runtimeScope": "r"
        }
    }))
    .expect("TS-shaped DeskRequest must deserialize");

    assert_eq!(request.method, "pointer");
    let input = request.input.as_object().expect("input object");
    assert_eq!(input["target"]["frameId"], json!("f1"));
    assert_eq!(input["expect"]["target"]["ref"], json!("@s1:e0"));
    assert_eq!(input["gesture"]["deltaX"], Value::Null); // click 没有 deltaX，只是证明没炸

    let response: DeskResponse = serde_json::from_value(json!({
        "id": "req-1",
        "ok": true,
        "result": { "capabilities": { "platform": "linux-wayland", "sessionType": "wayland" } },
        "possiblySent": false
    }))
    .expect("TS-shaped DeskResponse must deserialize");
    assert!(response.ok);
    assert!(!response.possibly_sent);

    let outcome: ActuationOutcome = serde_json::from_value(json!({
        "possiblySent": true,
        "verification": { "state": "deviation", "expected": "a", "observed": "b" },
        "snapshotId": "s2"
    }))
    .expect("TS-shaped ActuationOutcome must deserialize");
    assert!(outcome.possibly_sent);

    let clipboard: ClipboardResult = serde_json::from_value(json!({
        "text": null,
        "written": false,
        "note": "clipboard read is unavailable on this Wayland session"
    }))
    .expect("TS-shaped ClipboardResult must deserialize");
    assert!(clipboard.text.is_none());
    assert!(clipboard.note.is_some());
}
