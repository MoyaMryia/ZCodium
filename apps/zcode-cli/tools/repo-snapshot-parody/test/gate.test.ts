import assert from "node:assert/strict";
import test from "node:test";
import { PARODY_FLAG, PARODY_ENV_KEY, isTruthyFlagValue, isLoopbackHost, resolveParodyGate, assertLoopbackTarget } from "../src/gate.js";

test("未传开关时默认关闭，且给出启用方式", () => {
  const gate = resolveParodyGate({ argv: [], env: {} });
  assert.equal(gate.enabled, false);
  assert.equal(gate.source, "none");
  assert.match(gate.reason ?? "", /--parody-snapshot/u);
  assert.match(gate.reason ?? "", /ZCODE_PARODY_SNAPSHOT=1/u);
});

test("CLI flag 启用", () => {
  const gate = resolveParodyGate({ argv: [PARODY_FLAG, "capture"], env: {} });
  assert.equal(gate.enabled, true);
  assert.equal(gate.source, "flag");
});

test("env 启用", () => {
  const gate = resolveParodyGate({ argv: [], env: { [PARODY_ENV_KEY]: "1" } });
  assert.equal(gate.enabled, true);
  assert.equal(gate.source, "env");
});

test("flag 优先于 env 记录来源", () => {
  const gate = resolveParodyGate({ argv: [PARODY_FLAG], env: { [PARODY_ENV_KEY]: "1" } });
  assert.equal(gate.source, "flag");
});

test("真值只认显式集合", () => {
  for (const value of ["1", "true", "TRUE", " yes ", "on", "ON"]) {
    assert.equal(isTruthyFlagValue(value), true, `应当启用：${value}`);
  }
  for (const value of ["0", "false", "no", "off", "", " ", "2", "y", "t", "enabled", undefined]) {
    assert.equal(isTruthyFlagValue(value), false, `应当不启用：${value}`);
  }
});

test("回环判定", () => {
  for (const host of ["127.0.0.1", "127.0.0.2", "::1", "[::1]", "localhost", "LocalHost"]) {
    assert.equal(isLoopbackHost(host), true, `应当视为回环：${host}`);
  }
  for (const host of ["8.8.8.8", "zcode.z.ai", "192.168.1.10", "", "0.0.0.0"]) {
    assert.equal(isLoopbackHost(host), false, `应当拒绝：${host}`);
  }
});

test("非回环目标被拒绝", () => {
  assert.throws(() => assertLoopbackTarget("http://8.8.8.8/snapshot"), /拒绝非回环/u);
  assert.throws(() => assertLoopbackTarget("not-a-url"), /合法 URL/u);
  const url = assertLoopbackTarget("http://127.0.0.1:8787/snapshot");
  assert.equal(url.port, "8787");
});
