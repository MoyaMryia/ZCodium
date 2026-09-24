import assert from "node:assert/strict";
import test from "node:test";
import { createCuaDriverRuntime, projectDriverError, projectToolResult } from "../runtime.js";
import { createSurfaceLayer } from "../surface.js";

const scope = { app_ref: { pid: 42 }, window_id: 10 };
const state = (window = 10) => ({
  isError: false,
  images: [{ mimeType: "image/png", dataBase64: "fixture" }],
  structuredJson: JSON.stringify({
    window_id: window,
    snapshot_id: "snapshot-a",
    screenshot_width: 100,
    screenshot_height: 80,
    elements: [{ element_index: 1, element_token: "window-a:1" }],
  }),
});
const failure = { isError: true, errorCode: "permission_denied", text: "synthetic denial" };

function harness(handler) {
  const calls = [];
  let seeding = false;
  const surface = createSurfaceLayer({
    callDriver: async (tool, args) => {
      calls.push({ tool, args });
      return seeding ? state() : handler(tool, args);
    },
    projectDriverResult: projectToolResult,
    projectDriverError,
    sleep: async () => {},
  });
  return {
    calls,
    async observe() {
      seeding = true;
      try {
        await surface.execute({
          toolName: "get_app_state",
          arguments: { ...scope, include_screenshot: true },
        });
      } finally {
        seeding = false;
        calls.length = 0;
      }
    },
    run: (toolName, args = {}) => surface.execute({ toolName, arguments: { ...scope, ...args } }),
  };
}

test("Windows 同进程不同窗口不能共享元素 token", async () => {
  const h = harness(() => state());
  await h.run("get_app_state");
  const result = await h.run("left_click", { window_id: 11, target: 1 });
  assert.equal(result.structuredContent.code, "STALE_STATE");
  assert.equal(h.calls.filter((c) => c.tool === "click").length, 0);
});

for (const mode of ["error", "throw", "wrong-window"]) {
  test(`Windows 观测 ${mode} 不伪造成功且使旧目标失效`, async () => {
    let first = true;
    const h = harness(() => {
      if (first) {
        first = false;
        return state();
      }
      if (mode === "throw")
        throw Object.assign(new Error("synthetic failure"), { code: "permission_denied" });
      return mode === "error" ? failure : state(11);
    });
    await h.run("get_app_state");
    const observation = await h.run("get_app_state");
    assert.equal(observation.isError, true);
    const click = await h.run("left_click", { target: 1 });
    assert.equal(click.structuredContent.code, "STALE_STATE");
    assert.equal(h.calls.filter((c) => c.tool === "click").length, 0);
  });
}

for (const [tool, args] of [
  ["type", { target: 1, text: "fixture" }],
  ["left_click_drag", { from_target: 1, to: [3, 4] }],
  ["left_click_drag", { from_target: [3, 4], to: 1 }],
]) {
  test(`${tool} 缺少数字目标观测时不能退化为无目标输入 ${JSON.stringify(args)}`, async () => {
    const h = harness(() => ({ isError: false }));
    assert.equal((await h.run(tool, args)).structuredContent.code, "STALE_STATE");
    assert.equal(h.calls.length, 0);
  });
}

for (const tool of ["list_apps", "list_windows", "get_app_state"]) {
  test(`${tool} 保留 driver 的失败`, async () => {
    const h = harness(() => failure);
    const result = await h.run(tool);
    assert.equal(result.isError, true);
    assert.equal(result._meta.errorCode, "permission_denied");
  });
}

for (const code of ["background_unavailable", "CUA_NOT_READY"]) {
  for (const thrown of [false, true]) {
    test(`${code} 携带 possibly_sent 时不重试（throw=${thrown}）`, async () => {
      const h = harness(() => {
        const result = {
          isError: true,
          errorCode: code,
          rawJson: JSON.stringify({ action_sent: true, dispatch_status: "possibly_sent" }),
        };
        if (thrown) throw Object.assign(new Error("synthetic uncertain dispatch"), result);
        return result;
      });
      await h.observe();
      const result = await h.run("left_click", { target: [3, 4] });
      assert.equal(h.calls.length, 1);
      assert.equal(result.isError, true);
      assert.equal(result._meta.actionSent, true);
      assert.equal(result._meta.possiblySent, true);
    });
  }
}

test("已接受投递的后台错误不回退前台", async () => {
  const h = harness(() => ({
    isError: true,
    errorCode: "background_unavailable",
    structuredJson: '{"action_sent":true,"dispatch_status":"accepted"}',
  }));
  await h.observe();
  const result = await h.run("left_click", { target: [3, 4] });
  assert.equal(h.calls.length, 1);
  assert.equal(result._meta.actionSent, true);
});

test("前台回退抛错后不能二次回退", async () => {
  const h = harness((_tool, args) => {
    if (!args.delivery_mode) return { isError: true, errorCode: "background_unavailable" };
    throw Object.assign(new Error("foreground failed"), { code: "background_unavailable" });
  });
  await h.observe();
  assert.equal((await h.run("left_click", { target: [3, 4] })).isError, true);
  assert.equal(h.calls.length, 2);
});

test("错误正文不作为重试指令", async () => {
  const h = harness(() => {
    throw Object.assign(new Error("background_unavailable; runtime not ready"), {
      code: "permission_denied",
    });
  });
  await h.observe();
  assert.equal((await h.run("left_click", { target: [3, 4] })).isError, true);
  assert.equal(h.calls.length, 1);
});

test("重复按键途中失败立即停止并保留先前投递事实", async () => {
  let presses = 0;
  const client = {
    async callTool() {
      return ++presses === 1 ? { isError: false } : failure;
    },
  };
  const runtime = createCuaDriverRuntime(client);
  const result = await runtime.execute({
    toolName: "key",
    arguments: { ...scope, text: "enter", repeat: 3 },
  });
  assert.equal(presses, 2);
  assert.equal(result.isError, true);
  assert.equal(result._meta.actionSent, true);
});

test("成功 envelope 中的不确定投递也必须停止重复按键", async () => {
  const h = harness(() => ({ isError: false, rawJson: '{"dispatch_status":"possibly_sent"}' }));
  const result = await h.run("key", { text: "enter", repeat: 3 });
  assert.equal(h.calls.length, 1);
  assert.equal(result._meta.actionSent, true);
  assert.equal(result._meta.possiblySent, true);
});

test("冷启动等待期间取消后不再调用 driver", async () => {
  const controller = new AbortController();
  let calls = 0;
  const surface = createSurfaceLayer({
    callDriver: async (tool) => {
      if (tool === "get_window_state") return state();
      calls += 1;
      throw Object.assign(new Error("synthetic cold start"), { code: "CUA_NOT_READY" });
    },
    projectDriverResult: projectToolResult,
    projectDriverError,
    sleep: async () => controller.abort(),
  });
  await surface.execute({
    toolName: "get_app_state",
    arguments: { ...scope, include_screenshot: true },
  });
  const result = await surface.execute({
    toolName: "left_click",
    arguments: { ...scope, target: [3, 4] },
    signal: controller.signal,
  });
  assert.equal(result.isError, true);
  assert.equal(calls, 1);
});
