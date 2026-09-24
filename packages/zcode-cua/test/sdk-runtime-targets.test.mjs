import assert from "node:assert/strict";
import test from "node:test";
import { createCuaDriverRuntime } from "../runtime.js";
import { setupComputerUseRuntime } from "../../../apps/zcode-cli/packages/zcode-cua-plugin/scripts/computer-use-client.mjs";

const scope = { app_ref: { pid: 42 }, window_id: 10 };
const context = { sessionId: "fixture", runtimeScope: "main", workspaceKey: "fixture" };
async function fixture() {
  let serial = 0;
  const calls = [];
  const runtime = createCuaDriverRuntime({
    async callTool(tool, json) {
      const args = JSON.parse(json);
      calls.push({ tool, args });
      if (tool !== "get_window_state") return { isError: false, text: "ok" };
      const snapshot = `snapshot-${++serial}`;
      return {
        isError: false,
        text: '[7] entry "Message"',
        images: args.include_screenshot ? [{ mimeType: "image/png", dataBase64: "fixture" }] : [],
        structuredJson: JSON.stringify({
          snapshot_id: snapshot,
          frame_id: `raster-${serial}`,
          window_id: 10,
          app_name: "Fixture",
          screenshot_width: 100,
          screenshot_height: 80,
          window_bounds: { x: 200, y: 100, width: 100, height: 80 },
          elements: [
            {
              element_index: 7,
              element_token: `${snapshot}:7`,
              label: "Message",
              frame: { x: 210, y: 120, w: 20, h: 10 },
            },
          ],
        }),
      };
    },
  });
  const execute = (toolName, args = {}) =>
    runtime.execute({ toolName, arguments: { ...scope, ...args }, context });
  const globals = { process: { platform: "linux" }, nodeRepl: { write() {}, emitImage() {} } };
  globals[Symbol.for("zcode.node-repl.computer-use-bridge")] = {
    call: (toolName, args) => runtime.execute({ toolName, arguments: args, context }),
  };
  const cua = await setupComputerUseRuntime({ globals });
  const app = await cua.getWindow({ pid: 42 }, 10);
  return { app, execute, calls };
}

test("real skill SDK element targets reach click, scroll and set-value through the runtime", async () => {
  const { app, calls } = await fixture();
  await app.getAXState();
  await app.click(7);
  await app.scroll(7, "down", 2);
  await app.setValue(7, "fixture-value");
  for (const tool of ["click", "scroll", "set_value"]) {
    const { args } = calls.find((c) => c.tool === tool);
    assert.equal(args.element_token, "snapshot-2:7");
    assert.equal(args.element_index, undefined);
    assert.equal(args.pid, 42);
    assert.equal(args.window_id, 10);
  }
});

test("SDK raster clicks and drags use current screenshot pixels and actual driver argument names", async () => {
  const { app, calls } = await fixture();
  await app.getScreenshot({ emit: false });
  await app.click([12, 13]);
  await app.drag(7, [30, 40]);
  const click = calls.find((c) => c.tool === "click").args;
  assert.equal(click.x, 12);
  assert.equal(click.y, 13);
  const drag = calls.find((c) => c.tool === "drag").args;
  assert.deepEqual([drag.from_x, drag.from_y, drag.to_x, drag.to_y], [20, 25, 30, 40]);
  assert.equal(drag.from_element_token, undefined);
  assert.equal(drag.delivery_mode, undefined);
  await app.drag(7, [30, 40], { deliveryMode: "foreground" });
  assert.equal(calls.at(-1).args.delivery_mode, "foreground");
  const before = calls.length;
  await assert.rejects(app.drag(7, [30, 40], { deliveryMode: "invalid" }));
  assert.equal(calls.length, before);
});

test("no screenshot, stale frame, other window and out-of-raster targets cannot dispatch input", async () => {
  const { execute, calls } = await fixture();
  const reject = async (target, extra = {}) => {
    const before = calls.filter((c) => c.tool === "click").length;
    const result = await execute("left_click", { target, ...extra });
    assert.equal(result.isError, true);
    assert.equal(result._meta.actionSent, false);
    assert.equal(calls.filter((c) => c.tool === "click").length, before);
  };
  await reject({ type: "coordinate", x: 1, y: 2 });
  const state = await execute("get_app_state", { include_screenshot: true });
  const frame_id = state.structuredContent.frame_id;
  await reject({ type: "coordinate", frame_id, x: 100, y: 2 });
  await reject({ type: "coordinate", frame_id, x: -1, y: 2 });
  await reject({ type: "coordinate", frame_id, x: 1.5, y: 2 });
  await reject({ type: "coordinate", frame_id, x: 1, y: 2 }, { window_id: 11 });
  await execute("get_app_state", { include_screenshot: true });
  await reject({ type: "coordinate", frame_id, x: 1, y: 2 });
  await reject({ type: "element", index: 999 });
});

test("legacy targets and typed targets for type/set-value keep the same snapshot identity", async () => {
  const { execute, calls } = await fixture();
  await execute("get_app_state", { include_screenshot: true });
  assert.equal((await execute("left_click", { target: 7 })).isError, false);
  assert.equal((await execute("left_click", { target: [3, 4] })).isError, false);
  assert.equal(
    (await execute("type", { target: { type: "element", index: 7 }, text: "fixture" })).isError,
    false,
  );
  const typed = calls.find((c) => c.tool === "type_text").args;
  assert.equal(typed.element_token, "snapshot-2:7");
});

test("runtime stale targets tell the real SDK to reobserve without dispatching input", async () => {
  const { app, execute, calls } = await fixture();
  await app.getScreenshot({ emit: false });
  await execute("get_app_state", { include_screenshot: true });
  await assert.rejects(app.click([3, 4]), (error) => {
    assert.equal(error.code, "STALE_STATE");
    assert.equal(error.actionSent, false);
    assert.equal(error.retry, "reobserve");
    return true;
  });
  assert.equal(
    calls.some((call) => call.tool === "click"),
    false,
  );
});
