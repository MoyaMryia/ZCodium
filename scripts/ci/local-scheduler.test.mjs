import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { transform } from "esbuild";
import { tsImport } from "tsx/esm/api";
const shared = await tsImport("../../packages/shared/src/index.ts", import.meta.url);
const manualRelease = await tsImport(
  "../../packages/desktop/src/scheduler/manualClaimRelease.ts",
  import.meta.url,
);
const plain = (value) => JSON.parse(JSON.stringify(value));
async function load(path, imports, globals = {}) {
  const { code } = await transform(
    await readFile(new URL(`../../${path}`, import.meta.url), "utf8"),
    { loader: "ts", format: "cjs", target: "node24" },
  );
  const module = { exports: {} };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      assert.ok(name in imports, `Unexpected dependency: ${name}`);
      return imports[name];
    },
    setTimeout,
    clearTimeout,
    ...globals,
  });
  return module.exports;
}
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
};
const forbidden = () => {
  throw new Error("Retired idle dependency accessed");
};

test("scheduler retains scheduled/manual dispatch, settlement and shutdown without idle polling", async () => {
  const sent = [],
    calls = [];
  const automation = {
    automationId: "local",
    workspacePath: "/fixture",
    workspaceIdentity: "fixture-identity",
    prompt: "Fixture task",
    nextRunAt: Date.now(),
    dispatchAttempts: 0,
    modelSelection: { providerId: "fixture", modelId: "model" },
  };
  let due = [automation];
  let manual = [{ automation, run: { runId: "local:manual:fixture" } }];
  const repo = {
    async ensureReady() {
      calls.push(["ready"]);
    },
    async claimDue() {
      const value = due;
      due = [];
      return value;
    },
    async claimManualRuns() {
      const value = manual;
      manual = [];
      return value;
    },
    async upsertRunClaimed(input) {
      calls.push(["claim", plain(input)]);
    },
    async getRun() {
      return { workspaceKey: "fixture-identity" };
    },
    async get() {
      return automation;
    },
    async markRunDispatch(input) {
      calls.push(["run-result", plain(input)]);
    },
    async markDispatched(id) {
      calls.push(["dispatched", id]);
    },
    async markDispatchFailed(id, input) {
      calls.push(["failed", id, plain(input)]);
    },
    async markManualRunDispatched(input) {
      calls.push(["manual-result", plain(input)]);
    },
    async releaseManualClaim(...args) {
      calls.push(["manual-release", ...args]);
    },
    async releaseClaim(id) {
      calls.push(["release", id]);
    },
    close() {
      calls.push(["close"]);
    },
  };
  let receive;
  await load(
    "packages/desktop/src/scheduler/index.ts",
    {
      "@zcode/shared": shared,
      "@zcode/services/node": {
        AutomationRepo: class {
          constructor() {
            return repo;
          }
        },
        OffPeakTaskRepo: class {
          constructor() {
            forbidden();
          }
        },
        computeAutomationNextRunAt: () => Date.now() + 60000,
        isOneShotAutomation: () => false,
      },
      "./manualClaimRelease.js": manualRelease,
      "./offPeakDispatchSettlement.js": { settleOffPeakDispatchResult: forbidden },
      "./schedulerResourceTelemetry.js": {
        startSchedulerResourceTelemetry: () => ({ stop: () => calls.push(["diagnostics-stop"]) }),
      },
    },
    {
      process: {
        parentPort: {
          on(_event, listener) {
            receive = listener;
          },
          postMessage(message) {
            sent.push(plain(message));
          },
        },
        exit: (code) => calls.push(["exit", code]),
      },
      setInterval: () => 1,
      clearInterval() {},
    },
  );
  await flush();
  const dispatches = sent.filter((m) => m.type === "cron-dispatch-request");
  assert.equal(dispatches.length, 2);
  assert.ok(
    dispatches.every(
      (m) =>
        m.workspaceIdentity === "fixture-identity" && m.modelSelection.providerId === "fixture",
    ),
  );
  receive({
    data: {
      type: "cron-dispatch-result",
      runId: dispatches[0].runId,
      ok: true,
      sessionId: "session",
    },
  });
  receive({
    data: {
      type: "cron-dispatch-result",
      runId: dispatches[1].runId,
      ok: true,
      sessionId: "session",
    },
  });
  await flush();
  assert.ok(calls.some(([name]) => name === "dispatched"));
  // Accepted manual input keeps its claim until Host observes the actual turn terminal outcome.
  assert.equal(calls.filter(([name]) => name === "manual-release").length, 0);
  assert.ok(calls.some(([name]) => name === "manual-result"));
  manual = [{ automation, run: { runId: "local:manual:failed" } }];
  receive({ data: { type: "scheduler-wake", automationId: "local" } });
  await flush();
  receive({
    data: {
      type: "cron-dispatch-result",
      runId: "local:manual:failed",
      ok: false,
      failureKind: "transient",
    },
  });
  await flush();
  assert.ok(
    calls.some(
      ([name, id, key]) =>
        name === "manual-release" && id === "local" && key === "fixture-identity",
    ),
  );
  due = [{ ...automation, automationId: "retry" }];
  receive({ data: { type: "scheduler-wake", automationId: "retry" } });
  await flush();
  const retry = sent.find((m) => m.automationId === "retry");
  receive({
    data: {
      type: "cron-dispatch-result",
      runId: retry.runId,
      ok: false,
      failureKind: "transient",
      error: "Host unavailable",
    },
  });
  await flush();
  assert.ok(
    calls.some(
      ([name, id, result]) => name === "failed" && id === "retry" && result.kind === "transient",
    ),
  );
  due = [{ ...automation, automationId: "pending" }];
  manual = [{ automation, run: { runId: "local:manual:pending" } }];
  receive({ data: { type: "scheduler-wake", automationId: "pending" } });
  await flush();
  receive({ data: { type: "scheduler-dispose" } });
  await flush();
  assert.ok(calls.some(([name, id]) => name === "release" && id === "pending"));
  assert.ok(calls.some(([name]) => name === "diagnostics-stop"));
  assert.deepEqual(calls.slice(-2), [["close"], ["exit", 0]]);
  assert.ok(sent.every((m) => !m.type.startsWith("offpeak")));
});

test("Main ignores retired idle dispatch and keeps cron routing, wake and shutdown rejection", async () => {
  const child = new EventEmitter();
  const sent = [],
    hostSent = [];
  child.pid = 42;
  child.postMessage = (message) => sent.push(plain(message));
  child.kill = () => child.emit("exit", 0);
  let host = { postMessage: (message) => hostSent.push(plain(message)) };
  const { spawnCronScheduler } = await load("packages/desktop/src/main/desktopCronScheduler.ts", {
    electron: { utilityProcess: { fork: () => child } },
    "@zcode/shared": shared,
    "./desktopRuntimeEnv.js": {
      buildHostProcessEnv: () => ({}),
      schedulerModulePath: "/fixture/scheduler.js",
    },
    "./processResourceSelfHeapSource.js": { ingestSchedulerSelfResourceSample() {} },
    "./resourceManagerWindow.js": {
      registerSchedulerProcess() {},
      unregisterSchedulerProcess() {},
    },
  });
  const handle = spawnCronScheduler({
    hostProcessLocalEnv: {},
    logger: { info() {}, warn() {}, error() {} },
    resolveDispatchHost: () => host,
    onOffPeakActiveCountChanged: forbidden,
  });
  child.emit("message", { type: "offpeak-dispatch-request", offPeakTaskId: "old" });
  child.emit("message", { type: "offpeak-active-count", count: 1 });
  assert.deepEqual(hostSent, []);
  assert.equal("handleOffPeakRunResult" in handle, false);
  const request = {
    type: "cron-dispatch-request",
    automationId: "local",
    runId: "local-run",
    prompt: "Fixture",
    workspacePath: "/fixture",
    workspaceIdentity: "fixture-identity",
  };
  child.emit("message", request);
  assert.equal(hostSent[0].type, "cron-run");
  assert.equal(hostSent[0].workspaceIdentity, request.workspaceIdentity);
  handle.handleCronRunResult({ runId: "local-run", ok: true });
  handle.wake("local");
  assert.deepEqual(sent.slice(-2), [
    { type: "cron-dispatch-result", runId: "local-run", ok: true },
    { type: "scheduler-wake", automationId: "local" },
  ]);
  host = null;
  child.emit("message", request);
  assert.equal(sent.at(-1).failureKind, "transient");
  const disposing = handle.dispose();
  child.emit("message", request);
  assert.equal(sent.at(-1).error, "app is shutting down");
  child.emit("exit", 0);
  await disposing;
});
