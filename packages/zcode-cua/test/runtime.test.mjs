/**
 * `@zcode/zcode-cua` 运行时适配器单测。
 *
 * 覆盖 `.agents/specs/computer-use-runtime.md` 的验收场景 1、2、3：
 * 注入假 client 时能转发工具名与参数；driver 缺失时 fail-closed；
 * driver 抛错时保留错误码且不伪造成功。
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCuaDriverClient,
  createComputerUseRuntime,
  createCuaDriverRuntime,
  createUnavailableRuntime,
  projectDriverError,
  projectToolResult,
} from "../index.js";

const CONTEXT = { sessionId: "s1", runtimeScope: "main", workspaceKey: "ws" };

function makeResult(overrides = {}) {
  return {
    text: "ok",
    images: [],
    isError: false,
    degraded: false,
    rawJson: "{}",
    ...overrides,
  };
}

function makeClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async callTool(name, argumentsJson, options) {
      calls.push({ name, argumentsJson, options, argCount: arguments.length });
      return makeResult();
    },
    ...overrides,
  };
}

test("没有 client 时 fail-closed，且不抛异常", async () => {
  const runtime = createComputerUseRuntime();
  const result = await runtime.execute({ toolName: "click", arguments: {}, context: CONTEXT });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unavailable/i);
  await runtime.closeSession(CONTEXT);
  await runtime.dispose();
});

test("显式原因会原样出现在 fail-closed 结果里", async () => {
  const runtime = createUnavailableRuntime("driver missing for this platform");
  const result = await runtime.execute({ toolName: "click", arguments: {}, context: CONTEXT });
  assert.equal(result.content[0].text, "driver missing for this platform");
});

test("非法 client 降级为 fail-closed", async () => {
  const runtime = createComputerUseRuntime({ client: {} });
  const result = await runtime.execute({ toolName: "click", arguments: {}, context: CONTEXT });
  assert.equal(result.isError, true);
});

test("转发工具名、参数与 signal", async () => {
  const client = makeClient();
  const runtime = createCuaDriverRuntime(client);
  const controller = new AbortController();
  await runtime.execute({
    toolName: "get_window_state",
    arguments: { pid: 42, window_id: 7 },
    context: CONTEXT,
    signal: controller.signal,
  });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, "get_window_state");
  assert.deepEqual(JSON.parse(client.calls[0].argumentsJson), { pid: 42, window_id: 7 });
  assert.equal(client.calls[0].options.signal, controller.signal);
});

test("无 signal 时不传第三个参数（cua-driver SDK 会读 signal.aborted）", async () => {
  const client = makeClient();
  const runtime = createCuaDriverRuntime(client);
  await runtime.execute({ toolName: "list_apps", arguments: {}, context: CONTEXT });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].options, undefined);
  assert.equal(client.calls[0].argCount, 2);
});

test("缺工具名时直接报错，不调用 driver", async () => {
  const client = makeClient();
  const runtime = createCuaDriverRuntime(client);
  const result = await runtime.execute({ toolName: "", arguments: {}, context: CONTEXT });
  assert.equal(result.isError, true);
  assert.equal(client.calls.length, 0);
});

test("投影 text / image / structuredContent", () => {
  const projected = projectToolResult(
    makeResult({
      text: "clicked",
      images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
      structuredJson: JSON.stringify({ snapshot_id: "s123" }),
    }),
  );
  assert.deepEqual(projected.content[0], { type: "text", text: "clicked" });
  assert.deepEqual(projected.content[1], { type: "image", data: "AAAA", mimeType: "image/png" });
  assert.deepEqual(projected.structuredContent, { snapshot_id: "s123" });
  assert.equal(projected.isError, false);
});

test("rawJson 与 errorCode 经 _meta 透传", () => {
  const projected = projectToolResult(
    makeResult({ rawJson: JSON.stringify({ action: { delivered: true } }), errorCode: "X" }),
  );
  assert.equal(projected._meta.errorCode, "X");
  assert.deepEqual(projected._meta.driverResult, { action: { delivered: true } });
});

test("非法 structuredJson 不抛异常，也不产生 structuredContent", () => {
  const projected = projectToolResult(makeResult({ structuredJson: "{not json", text: "" }));
  assert.equal(projected.structuredContent, undefined);
  assert.equal(projected.content.length, 0);
});

test("driver 抛错保留错误码，不伪造成功", async () => {
  const client = makeClient({
    async callTool() {
      const error = new Error("background delivery refused");
      error.errorCode = "background_unavailable";
      throw error;
    },
  });
  const runtime = createCuaDriverRuntime(client);
  const result = await runtime.execute({ toolName: "click", arguments: {}, context: CONTEXT });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "background_unavailable");
  assert.match(result.content[0].text, /background delivery refused/);
});

test("projectDriverError 对非 Error 值也稳定", () => {
  const result = projectDriverError("click", "boom");
  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "boom");
});

test("dispose 转发且幂等；closeSession 走 endSession", async () => {
  let disposed = 0;
  let ended = 0;
  const client = makeClient({
    async dispose() {
      disposed += 1;
    },
    async endSession() {
      ended += 1;
    },
  });
  const runtime = createCuaDriverRuntime(client);
  await runtime.closeSession(CONTEXT);
  assert.equal(ended, 1);
  await runtime.dispose();
  await runtime.dispose();
  assert.equal(disposed, 2);
});

test("client 判定：缺 callTool 时报原因", () => {
  assert.equal(typeof assertCuaDriverClient(undefined), "string");
  assert.equal(typeof assertCuaDriverClient({}), "string");
  assert.equal(assertCuaDriverClient({ callTool() {} }), undefined);
});
