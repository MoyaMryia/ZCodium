/**
 * `surface.js` 单测：ZCode 14 工具名 → cua-driver / 兼容层的映射与目标解析。
 *
 * 契约见 `.agents/specs/computer-use-capabilities.md` §2、§3。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createCuaDriverRuntime } from "../index.js";
import { createSurfaceLayer, parseKeyChord, ZCODE_SURFACE_TOOLS } from "../surface.js";

const ELEMENTS = [{ element_index: 202, element_token: "s1:202", label: "5", frame: { x: 282, y: 517, w: 60, h: 44 } }];

const projectDriverResult = (raw) => ({
  content: raw?.text ? [{ type: "text", text: raw.text }] : [],
  isError: false,
  _meta: { driverResult: raw?.structuredJson },
});
const projectDriverError = (tool, error) => ({
  content: [{ type: "text", text: String(error?.message ?? error) }],
  isError: true,
  structuredContent: { tool, code: error?.code },
});

function windowStateHandler() {
  return () => ({
    text: "tree",
    structuredJson: JSON.stringify({ snapshot_id: "s1", elements: ELEMENTS, app_name: "Calculator" }),
    images: [],
    isError: false,
  });
}

function makeSurface(handlers = {}, compat = null) {
  const calls = [];
  const callDriver = async (name, args) => {
    calls.push({ name, args });
    const handler = handlers[name];
    return handler ? handler(args) : { text: "", structuredJson: "{}", images: [], isError: false, degraded: false, rawJson: "{}" };
  };
  const surface = createSurfaceLayer({ callDriver, compat, compatApplies: Boolean(compat), projectDriverResult, projectDriverError });
  return { surface, calls };
}

function makeCompat() {
  const calls = [];
  return {
    calls,
    applies: true,
    async execute(input) {
      calls.push(input);
      return { content: [{ type: "text", text: "compat ok" }], isError: false, _meta: { compat: true, actionSent: true } };
    },
  };
}

test("14 个工具名齐全", () => {
  assert.equal(ZCODE_SURFACE_TOOLS.length, 14);
  assert.ok(ZCODE_SURFACE_TOOLS.includes("left_click"));
  assert.ok(ZCODE_SURFACE_TOOLS.includes("get_app_state"));
});

test("parseKeyChord 拆分修饰键与末键", () => {
  assert.deepEqual(parseKeyChord("ctrl+shift+t"), { modifiers: ["ctrl", "shift"], key: "t" });
  assert.deepEqual(parseKeyChord("enter"), { modifiers: [], key: "enter" });
});

test("list_apps / list_windows 读 structuredJson", async () => {
  const { surface } = makeSurface({
    list_apps: () => ({ structuredJson: JSON.stringify({ apps: [{ name: "Calculator", pid: 100 }] }), text: "human list", isError: false }),
    list_windows: () => ({ structuredJson: JSON.stringify({ windows: [{ window_id: 58, title: "Calculator" }] }), isError: false }),
  });
  assert.deepEqual(JSON.parse((await surface.execute({ toolName: "list_apps", arguments: {} })).content[0].text), [{ name: "Calculator", pid: 100 }]);
  assert.deepEqual(JSON.parse((await surface.execute({ toolName: "list_windows", arguments: { app_ref: { pid: 100 } } })).content[0].text), [{ window_id: 58, title: "Calculator" }]);
});

test("get_app_state 记录快照并投影 state_id/elements", async () => {
  const { surface } = makeSurface({ get_window_state: windowStateHandler() });
  const result = await surface.execute({ toolName: "get_app_state", arguments: { app_ref: { pid: 100 }, window_id: 58 } });
  assert.equal(result.structuredContent.state_id, "s1");
  assert.equal(result.structuredContent.elements.length, 1);
  assert.equal(result.structuredContent.app.pid, 100);
});

test("left_click 把 element index 传给兼容层（token 会被重新观测而失效）", async () => {
  const compat = makeCompat();
  const { surface } = makeSurface({ get_window_state: windowStateHandler() }, compat);
  await surface.execute({ toolName: "get_app_state", arguments: { app_ref: { pid: 100 }, window_id: 58 } });
  compat.calls.length = 0;
  const result = await surface.execute({ toolName: "left_click", arguments: { app_ref: { pid: 100 }, window_id: 58, target: 202 } });
  assert.equal(result.isError, false);
  assert.equal(compat.calls.length, 1);
  assert.equal(compat.calls[0].toolName, "click");
  assert.equal(compat.calls[0].arguments.element_index, 202);
  assert.equal(compat.calls[0].arguments.element_token, undefined);
});

test("无观测就动作 → STALE_STATE", async () => {
  const { surface } = makeSurface({}, makeCompat());
  const result = await surface.execute({ toolName: "left_click", arguments: { app_ref: { pid: 100 }, window_id: 58, target: 999 } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "STALE_STATE");
});

test("key 的 chord 走 hotkey，单键走 press_key", async () => {
  const compat = makeCompat();
  const { surface } = makeSurface({}, compat);
  await surface.execute({ toolName: "key", arguments: { app_ref: { pid: 100 }, window_id: 58, text: "ctrl+shift+t" } });
  assert.equal(compat.calls.at(-1).toolName, "hotkey");
  assert.deepEqual(compat.calls.at(-1).arguments.keys, ["ctrl", "shift", "t"]);
  await surface.execute({ toolName: "key", arguments: { app_ref: { pid: 100 }, window_id: 58, text: "enter" } });
  assert.equal(compat.calls.at(-1).toolName, "press_key");
  assert.equal(compat.calls.at(-1).arguments.key, "enter");
});

test("paste = clipboard_write(驱动) + hotkey(兼容层)", async () => {
  const compat = makeCompat();
  const { surface, calls } = makeSurface({ clipboard_write: () => ({ structuredJson: "{}", text: "ok", isError: false }) }, compat);
  await surface.execute({ toolName: "paste", arguments: { text: "hi" } });
  assert.ok(calls.some((call) => call.name === "clipboard_write" && call.args.text === "hi"));
  assert.equal(compat.calls.at(-1).toolName, "hotkey");
  assert.deepEqual(compat.calls.at(-1).arguments.keys, ["ctrl", "v"]);
});

test("select_text / perform_action → ACTION_UNAVAILABLE", async () => {
  const { surface } = makeSurface({}, makeCompat());
  for (const toolName of ["select_text", "perform_action"]) {
    const result = await surface.execute({ toolName, arguments: {} });
    assert.equal(result.isError, true, toolName);
    assert.equal(result.structuredContent.code, "ACTION_UNAVAILABLE", toolName);
  }
});

test("request_access 全批准", async () => {
  const { surface } = makeSurface({ check_permissions: () => ({ structuredJson: "{}", text: "ok", isError: false }) });
  const result = await surface.execute({ toolName: "request_access", arguments: {} });
  assert.equal(result.structuredContent.granted, true);
});

test("runtime 识别 ZCode 工具名并走 surface", async () => {
  const client = {
    async callTool(name) {
      if (name === "get_window_state") return { text: "t", structuredJson: JSON.stringify({ snapshot_id: "s9", elements: [] }), isError: false };
      return { text: "", structuredJson: "{}", images: [], isError: false };
    },
  };
  const runtime = createCuaDriverRuntime(client, {});
  const result = await runtime.execute({ toolName: "get_app_state", arguments: { app_ref: { pid: 1 }, window_id: 2 }, context: {} });
  assert.equal(result.structuredContent.state_id, "s9");
});