/**
 * DeskPilot P0 契约单测。
 *
 * 覆盖 `.agents/specs/desk-pilot.md` 的验收场景 4（契约不变量）：
 * ref 格式非法、跨 snapshot 寻址、无 frame 的坐标目标、密码字段脱敏，
 * 都必须在进入 adapter 之前被拒绝。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DESK_ERROR_CODES,
  DeskPilotError,
  isDeskErrorCode,
  type SurfaceAdapter,
} from "../src/contract.js";
import {
  assertCoordinateTarget,
  assertElementTarget,
  freezeCapabilitySet,
  isSecureElement,
  normalizeKeyChord,
  parseElementRef,
  redactSecureValue,
} from "../src/guards.js";
import { observePressables, pressElement } from "../src/contract.example.js";
import { FakeSurfaceAdapter } from "./fixtures/fakeAdapter.js";

const SNAPSHOT = "s_fake01";

function deskError(fn: () => unknown): DeskPilotError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof DeskPilotError, `expected DeskPilotError, got ${String(error)}`);
    return error;
  }
  throw new assert.AssertionError({ message: "expected a throw" });
}

test("SurfaceAdapter port exposes exactly twelve methods", () => {
  const adapter = new FakeSurfaceAdapter();
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).filter(
    (name) =>
      name !== "constructor" &&
      typeof (adapter as unknown as Record<string, unknown>)[name] === "function",
  );
  const port: (keyof SurfaceAdapter)[] = [
    "capabilities",
    "surfaces",
    "observe",
    "inspect",
    "semantic",
    "pointer",
    "text",
    "key",
    "clipboard",
    "attachCdp",
    "requestAccess",
    "shutdown",
  ];
  assert.equal(names.length, port.length);
  for (const name of port) assert.ok(names.includes(name), `missing ${name}`);
});

test("DESK_ERROR_CODES is closed and isDeskErrorCode rejects unknown values", () => {
  assert.equal(new Set(DESK_ERROR_CODES).size, DESK_ERROR_CODES.length);
  assert.ok(isDeskErrorCode("STALE_REF"));
  assert.ok(isDeskErrorCode("UNSUPPORTED_ON_PLATFORM"));
  assert.ok(!isDeskErrorCode("MADE_UP_CODE"));
  assert.ok(!isDeskErrorCode(42));
});

test("DeskPilotError carries possiblySent so callers can distinguish touched from untouched", () => {
  const untouched = new DeskPilotError({
    code: "INVALID_ARGUMENT",
    message: "bad ref",
    possiblySent: false,
  });
  assert.equal(untouched.possiblySent, false);
  assert.equal(untouched.recovery, null);

  const touched = new DeskPilotError({
    code: "DEVIATION",
    message: "send did not change the UI",
    possiblySent: true,
    recovery: "Re-observe and retry once.",
  });
  assert.equal(touched.possiblySent, true);
  assert.equal(touched.recovery, "Re-observe and retry once.");
});

test("parseElementRef accepts the documented shape and rejects everything else", () => {
  assert.deepEqual(parseElementRef("@s_fake01:e7"), { snapshotId: "s_fake01", index: 7 });
  assert.deepEqual(parseElementRef("@s-9_x:e123"), { snapshotId: "s-9_x", index: 123 });

  for (const bad of [
    "",
    "@:e1",
    "@s_fake01:e0",
    "@s_fake01:e",
    "@s_fake01:7",
    "s_fake01:e7",
    "@s_fake01:e7 ",
    "@s_fake!!:e7",
    "@s_fake01:e1234567",
  ]) {
    assert.equal(parseElementRef(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("assertElementTarget rejects malformed refs with possiblySent false", () => {
  const error = deskError(() =>
    assertElementTarget({ kind: "element", snapshotId: SNAPSHOT, ref: "nope" }, SNAPSHOT),
  );
  assert.equal(error.code, "INVALID_ARGUMENT");
  assert.equal(error.possiblySent, false);
});

test("assertElementTarget rejects cross-snapshot addressing as STALE_REF", () => {
  const error = deskError(() =>
    assertElementTarget({ kind: "element", snapshotId: "s_old", ref: "@s_old:e3" }, SNAPSHOT),
  );
  assert.equal(error.code, "STALE_REF");
  assert.equal(error.possiblySent, false);
  assert.match(error.message, /belongs to snapshot s_old/);
  assert.ok(error.recovery?.includes("observe"));
});

test("assertElementTarget accepts a ref bound to the latest snapshot", () => {
  assert.doesNotThrow(() =>
    assertElementTarget({ kind: "element", snapshotId: SNAPSHOT, ref: "@s_fake01:e1" }, SNAPSHOT),
  );
});

test("assertCoordinateTarget rejects frameless, fractional, negative and non-finite coordinates", () => {
  const frameless = deskError(() =>
    assertCoordinateTarget({ kind: "coordinate", frameId: "", x: 1, y: 1 }),
  );
  assert.equal(frameless.code, "INVALID_ARGUMENT");

  const fractional = deskError(() =>
    assertCoordinateTarget({ kind: "coordinate", frameId: "f_fake01", x: 10.5, y: 4 }),
  );
  assert.equal(fractional.code, "INVALID_ARGUMENT");
  assert.match(fractional.message, /integer/);

  const negative = deskError(() =>
    assertCoordinateTarget({ kind: "coordinate", frameId: "f_fake01", x: -1, y: 4 }),
  );
  assert.equal(negative.code, "INVALID_ARGUMENT");

  const notFinite = deskError(() =>
    assertCoordinateTarget({ kind: "coordinate", frameId: "f_fake01", x: Number.NaN, y: 4 }),
  );
  assert.equal(notFinite.code, "INVALID_ARGUMENT");

  assert.doesNotThrow(() =>
    assertCoordinateTarget({ kind: "coordinate", frameId: "f_fake01", x: 0, y: 0 }),
  );
});

test("normalizeKeyChord maps cmd to ctrl outside darwin and keeps it on darwin", () => {
  const chord = { key: "s", modifiers: ["cmd", "shift"] as const };
  assert.deepEqual(normalizeKeyChord(chord, "darwin"), chord);
  assert.deepEqual(normalizeKeyChord(chord, "win32"), { key: "s", modifiers: ["ctrl", "shift"] });
  assert.deepEqual(normalizeKeyChord(chord, "linux-x11"), {
    key: "s",
    modifiers: ["ctrl", "shift"],
  });
  assert.deepEqual(normalizeKeyChord(chord, "linux-wayland"), {
    key: "s",
    modifiers: ["ctrl", "shift"],
  });
});

test("secure element values are redacted and detected by flag", async () => {
  const adapter = new FakeSurfaceAdapter();
  const map = await adapter.observe({ surface: adapter.surface });
  const password = map.elements.find((element) => element.name === "Password");
  assert.ok(password);
  assert.ok(isSecureElement(password));
  assert.equal(redactSecureValue(password.value), "«redacted»");
  assert.equal(redactSecureValue(null), null);

  const send = map.elements.find((element) => element.name === "Send");
  assert.ok(send);
  assert.ok(!isSecureElement(send));
});

test("freezeCapabilitySet deep-freezes the declared capability set", async () => {
  const adapter = new FakeSurfaceAdapter();
  const frozen = freezeCapabilitySet(await adapter.capabilities());
  assert.throws(() => {
    (frozen.primitives as { pointer: boolean }).pointer = false;
  }, TypeError);
  assert.throws(() => {
    (frozen.notes as string[]).push("smuggled");
  }, TypeError);
  assert.equal(frozen.primitives.pointer, true);
});

test("wayland adapter reports pointer and capture as unavailable instead of pretending", async () => {
  const adapter = new FakeSurfaceAdapter({ platform: "linux-wayland" });
  const capability = await adapter.capabilities();
  assert.equal(capability.sessionType, "wayland");
  assert.equal(capability.primitives.pointer, false);
  assert.equal(capability.primitives.keyboard, false);
  assert.equal(capability.primitives.capture, false);
  assert.equal(capability.primitives.semantic, true);
  assert.equal(capability.grants.portal_screencast, "denied");
  assert.ok(capability.notes.length > 0);
});

test("requestAccess only reports and never claims to escalate", async () => {
  const adapter = new FakeSurfaceAdapter();
  const granted = await adapter.requestAccess("accessibility");
  assert.equal(granted.state, "granted");
  assert.equal(granted.remediation, null);

  const denied = await adapter.requestAccess("screen_recording");
  assert.equal(denied.state, "denied");
  assert.ok(denied.remediation?.includes("Grant screen_recording"));
});

test("adapter records dispatch so tests can prove whether the platform was touched", async () => {
  const adapter = new FakeSurfaceAdapter();
  assert.deepEqual(adapter.dispatched, []);

  await adapter.semantic({
    target: { kind: "element", snapshotId: SNAPSHOT, ref: "@s_fake01:e1" },
    action: "press",
  });
  await adapter.key({ key: "s", modifiers: ["cmd"] });
  await adapter.clipboard({ kind: "write", text: "hello" });

  assert.deepEqual(adapter.dispatched, ["semantic:press:element", "key:s", "clipboard:write"]);
  assert.deepEqual(await adapter.clipboard({ kind: "read" }), {
    text: "hello",
    written: false,
    note: null,
  });
});

test("inspect returns null for a snapshot the adapter no longer owns", async () => {
  const adapter = new FakeSurfaceAdapter();
  assert.ok(await adapter.inspect({ snapshotId: SNAPSHOT, ref: "@s_fake01:e1" }));
  assert.equal(await adapter.inspect({ snapshotId: "s_old", ref: "@s_old:e1" }), null);
});

test("shutdown is idempotent", async () => {
  const adapter = new FakeSurfaceAdapter();
  await adapter.shutdown();
  await adapter.shutdown();
  assert.equal(adapter.isStopped, true);
});

test("contract example drives observe then act through the port only", async () => {
  const adapter = new FakeSurfaceAdapter();
  const view = await observePressables(adapter, adapter.surface);
  assert.equal(view.snapshotId, SNAPSHOT);
  assert.deepEqual(
    view.elements.map((element) => element.name),
    ["Send"],
  );

  const outcome = await pressElement(adapter, {
    snapshotId: view.snapshotId,
    ref: "@s_fake01:e1",
    action: "press",
  });
  assert.equal(outcome, "sent/unverified");
  assert.deepEqual(adapter.dispatched, ["semantic:press:element"]);
});

test("contract example refuses a stale ref before the adapter is touched", async () => {
  const adapter = new FakeSurfaceAdapter();
  await assert.rejects(
    () => pressElement(adapter, { snapshotId: SNAPSHOT, ref: "@s_old:e1", action: "press" }),
    (error: unknown) => {
      assert.ok(error instanceof DeskPilotError);
      assert.equal(error.code, "STALE_REF");
      assert.equal(error.possiblySent, false);
      return true;
    },
  );
  assert.deepEqual(adapter.dispatched, []);
});
