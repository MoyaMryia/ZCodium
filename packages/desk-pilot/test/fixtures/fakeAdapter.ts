/**
 * 内存假 adapter：用于契约单测，不碰任何真实平台。
 *
 * 它存在的意义是证明 `SurfaceAdapter` 这 12 个方法足够表达核心工作流，
 * 并且让"参数校验失败时 possiblySent 必须是 false"这类不变量可被断言。
 */

import type {
  AccessReport,
  AccessScope,
  ActuationOutcome,
  CapabilitySet,
  CdpAttachRequest,
  CdpEndpoint,
  ClipboardOp,
  ClipboardResult,
  KeyChord,
  ObserveRequest,
  PointerRequest,
  SemanticRequest,
  SurfaceAdapter,
  SurfaceRef,
  SurfaceSummary,
  TextRequest,
  UiElement,
  UiMap,
} from "../../src/contract.js";
import type { ElementHandle } from "../../src/ui-map.js";

export interface FakeElementSeed {
  readonly ref: string;
  readonly kind: UiElement["kind"];
  readonly name: string;
  readonly value?: string | null;
  readonly flags?: readonly UiElement["flags"][number][];
  readonly actions?: readonly string[];
}

export interface FakeAdapterOptions {
  readonly platform?: CapabilitySet["platform"];
  readonly snapshotId?: string;
  readonly frameId?: string;
  readonly surface?: SurfaceRef;
  readonly elements?: readonly FakeElementSeed[];
}

const UNVERIFIED: ActuationOutcome["verification"] = {
  state: "unverified",
  reason: "fake adapter does not re-observe",
};

export class FakeSurfaceAdapter implements SurfaceAdapter {
  readonly platform: CapabilitySet["platform"];
  readonly sessionType: CapabilitySet["sessionType"];
  readonly snapshotId: string;
  readonly frameId: string;
  readonly surface: SurfaceRef;
  readonly elements: readonly UiElement[];

  /** 每次成功下达平台的调用都记一行，用于断言"到底动没动"。 */
  readonly dispatched: string[] = [];
  readonly observedSurfaces: SurfaceRef[] = [];

  private readonly granted: ReadonlySet<AccessScope>;
  private clipboardText: string | null = null;
  private stopped = false;

  constructor(options: FakeAdapterOptions = {}) {
    this.platform = options.platform ?? "linux-x11";
    this.sessionType = this.platform === "linux-wayland" ? "wayland" : "x11";
    this.snapshotId = options.snapshotId ?? "s_fake01";
    this.frameId = options.frameId ?? "f_fake01";
    this.surface = options.surface ?? { pid: 4242, bundleId: null, name: "FakeApp", windowId: 7 };
    this.elements = (options.elements ?? defaultSeeds()).map((seed) => ({
      ref: seed.ref,
      kind: seed.kind,
      name: seed.name,
      value: seed.value ?? null,
      bounds: { x: 10, y: 20, width: 80, height: 24 },
      flags: seed.flags ?? [],
      actions: seed.actions ?? [],
      provenance: {
        source: "a11y",
        confidence: 1,
        observedAtMs: 1_700_000_000_000,
        fingerprint: `${seed.kind}@${seed.name}@/win[0]`,
      },
    }));
    this.granted = new Set<AccessScope>(["accessibility"]);
  }

  async capabilities(): Promise<CapabilitySet> {
    return {
      platform: this.platform,
      sessionType: this.sessionType,
      perception: { a11y: "available", ocr: "degraded", dom: "unavailable", vision: "degraded" },
      primitives: {
        pointer: this.platform !== "linux-wayland",
        keyboard: this.platform !== "linux-wayland",
        semantic: true,
        capture: this.platform !== "linux-wayland",
        clipboardRead: this.platform !== "linux-wayland",
        windowEnumerate: true,
        backgroundInput: this.platform === "darwin",
      },
      grants: {
        accessibility: "granted",
        screen_recording: "denied",
        input_monitoring: "not_applicable",
        automation: "not_applicable",
        portal_screencast: this.platform === "linux-wayland" ? "denied" : "not_applicable",
        portal_remotedesktop: this.platform === "linux-wayland" ? "denied" : "not_applicable",
      },
      notes: this.platform === "linux-wayland" ? ["libei portal grant missing"] : [],
    };
  }

  async surfaces(): Promise<readonly SurfaceSummary[]> {
    return [
      {
        surface: this.surface,
        title: "Fake Window",
        main: true,
        focused: true,
        onScreen: true,
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    ];
  }

  async observe(request: ObserveRequest): Promise<UiMap> {
    this.observedSurfaces.push(request.surface);
    return {
      snapshotId: this.snapshotId,
      surface: this.surface,
      frame: {
        frameId: this.frameId,
        widthPx: 800,
        heightPx: 600,
        scaleFactor: 1,
        capturedAtMs: 1_700_000_000_000,
      },
      sourceMix: { a11y: this.elements.length },
      truncated: false,
      truncatedAtDepth: null,
      elements: this.elements,
    };
  }

  async inspect(handle: ElementHandle): Promise<UiElement | null> {
    if (handle.snapshotId !== this.snapshotId) return null;
    return this.elements.find((element) => element.ref === handle.ref) ?? null;
  }

  async semantic(request: SemanticRequest): Promise<ActuationOutcome> {
    this.dispatched.push(`semantic:${request.action}:${request.target.kind}`);
    return { possiblySent: true, verification: UNVERIFIED, snapshotId: null };
  }

  async pointer(request: PointerRequest): Promise<ActuationOutcome> {
    this.dispatched.push(`pointer:${request.gesture.kind}`);
    return { possiblySent: true, verification: UNVERIFIED, snapshotId: null };
  }

  async text(request: TextRequest): Promise<ActuationOutcome> {
    this.dispatched.push(`text:${request.op.kind}`);
    return { possiblySent: true, verification: UNVERIFIED, snapshotId: null };
  }

  async key(chord: KeyChord): Promise<ActuationOutcome> {
    this.dispatched.push(`key:${chord.key}`);
    return { possiblySent: true, verification: UNVERIFIED, snapshotId: null };
  }

  async clipboard(op: ClipboardOp): Promise<ClipboardResult> {
    if (op.kind === "write") {
      this.clipboardText = op.text;
      this.dispatched.push("clipboard:write");
      return { text: null, written: true, note: null };
    }
    this.dispatched.push("clipboard:read");
    return { text: this.clipboardText, written: false, note: null };
  }

  async attachCdp(request: CdpAttachRequest): Promise<CdpEndpoint> {
    return {
      port: 9222,
      httpEndpoint: "http://127.0.0.1:9222",
      websocketUrl: `ws://127.0.0.1:9222/devtools/browser/${request.pid}`,
      product: "Fake/1.0",
    };
  }

  async requestAccess(scope: AccessScope): Promise<AccessReport> {
    if (this.granted.has(scope)) return { scope, state: "granted", remediation: null };
    return {
      scope,
      state: "denied",
      remediation: `Grant ${scope} in system settings, then retry.`,
    };
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
  }

  get isStopped(): boolean {
    return this.stopped;
  }
}

function defaultSeeds(): readonly FakeElementSeed[] {
  return [
    { ref: "@s_fake01:e1", kind: "button", name: "Send", flags: ["pressable"], actions: ["press"] },
    {
      ref: "@s_fake01:e2",
      kind: "textfield",
      name: "Recipient",
      value: "",
      flags: ["editable", "settable", "selectable"],
      actions: [],
    },
    {
      ref: "@s_fake01:e3",
      kind: "textfield",
      name: "Password",
      value: "hunter2",
      flags: ["editable", "secure"],
      actions: [],
    },
  ];
}
