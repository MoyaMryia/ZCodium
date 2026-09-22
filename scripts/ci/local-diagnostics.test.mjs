import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const runtimeEnv = await tsImport("../../packages/shared/src/runtimeEnv.ts", import.meta.url);
const { createTaskActivityTracker } = await tsImport(
  "../../packages/zcode-server-cli/src/server-core/taskActivityTracker.ts",
  import.meta.url,
);
const { createLocalTtftDiagnostics } = await tsImport(
  "../../packages/desktop/src/main/localTtftDiagnostics.ts",
  import.meta.url,
);

test("removed instrumentation credentials never reach tool environments", () => {
  const input = {
    PATH: "/example/bin",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.invalid",
    OTEL_EXPORTER_OTLP_HEADERS: "Authorization=private",
    otel_resource_attributes: "user=private",
    ZCODE_TELEMETRY_DEVICE_MID: "private",
    ZCODE_ARMS_RUM_ENDPOINT: "https://collector.invalid",
    ZCODE_MODEL_TELEMETRY_ENABLED: "1",
    ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
  };
  assert.deepEqual(runtimeEnv.sanitizeZCodeRuntimeEnv(input), { PATH: "/example/bin" });
  const inplace = { ...input };
  runtimeEnv.sanitizeZCodeRuntimeEnvInPlace(inplace);
  assert.deepEqual(inplace, { PATH: "/example/bin" });
  for (const key of Object.keys(input).filter((key) => key !== "PATH")) {
    assert.equal(runtimeEnv.shouldCaptureZCodeToolEnvPassthroughKey(key), false);
  }
});

test("task activity is idempotent, isolates workspace identity and rejects retired runtime callbacks", () => {
  let lifecycle;
  const subscriptions = [];
  const source = {
    onAgentRuntimeLifecycle(listener) {
      lifecycle = listener;
      return { dispose() {} };
    },
    onDynamicSessionActivity(target) {
      return (listener) => {
        const subscription = { target, listener, disposed: false };
        subscriptions.push(subscription);
        return {
          dispose() {
            subscription.disposed = true;
          },
        };
      };
    },
  };
  const tracker = createTaskActivityTracker(source);
  const publish = (identity, runtime, state = "available") =>
    lifecycle({
      workspacePath: "/same/path",
      workspaceIdentity: identity,
      workspaceKey: identity,
      runtimeIdentity: { identity: runtime },
      state,
    });
  publish("remote:a", "a1");
  publish("remote:b", "b1");
  const a1 = subscriptions[0].listener;
  const b1 = subscriptions[1].listener;
  a1({ sessionId: "session", state: "running" });
  a1({ sessionId: "session", state: "running" });
  b1({ sessionId: "session", state: "running" });
  assert.equal(tracker.readRunningTaskCount(), 2);
  publish("remote:a", "a2");
  assert.equal(subscriptions[0].disposed, true);
  a1({ sessionId: "late", state: "running" });
  assert.equal(tracker.readRunningTaskCount(), 1);
  publish("remote:a", "a1", "unavailable");
  subscriptions[2].listener({ sessionId: "new", state: "running" });
  assert.equal(tracker.readRunningTaskCount(), 2);
  b1({ sessionId: "session", state: "idle" });
  b1({ sessionId: "session", state: "idle" });
  assert.equal(tracker.readRunningTaskCount(), 1);
  publish("remote:a", "a2", "unavailable");
  assert.equal(tracker.readRunningTaskCount(), 0);
  tracker.dispose();
  b1({ sessionId: "late", state: "running" });
  assert.equal(tracker.readRunningTaskCount(), 0);
});

test("TTFT diagnostics validate and deduplicate records and log only local timing summaries", () => {
  const logs = [];
  const diagnostics = createLocalTtftDiagnostics({
    now: () => 10_000,
    logger: { debug: (...args) => logs.push(args) },
  });
  const batch = {
    version: 1,
    rendererInstanceId: "private-renderer",
    sequence: 0,
    dropped: 0,
    records: [
      {
        version: 1,
        observationId: "d35ca5f3-a5b8-4e01-a314-b066606a1133",
        kind: "first_text",
        outcome: "success",
        start: 9_000,
        end: 9_050,
        quality: "complete",
        intervals: [{ stage: "model_request", start: 9010, end: 9040, source: "cli" }],
      },
    ],
  };
  diagnostics.record(batch);
  diagnostics.record(batch);
  diagnostics.record({ ...batch, credentials: "private" });
  assert.equal(logs.length, 2);
  assert.equal(logs[0][1].metrics.durationMs, 50);
  assert.match(logs[0][1].traceId, /^[a-f0-9]{32}$/);
  assert.equal(logs[1][1].traceId, logs[0][1].traceId);
  assert.equal(logs[1][1].parentSpanId, logs[0][1].spanId);
  assert.equal(logs[1][1].timestampUnixMs, 9040);
  assert.equal(logs[1][1].metrics.startTimeUnixMs, 9010);
  assert.equal(logs[1][1].sequence, 1);
  assert.doesNotMatch(JSON.stringify(logs), /private-/);
});

const { onboardingRecordFileSchema } = await tsImport(
  "../../packages/shared/src/onboardingRecord.ts",
  import.meta.url,
);
test("legacy onboarding records retain preferences without persisting analytics fields", () => {
  const entry = {
    userId: null,
    occupation: "writer",
    interfaceMode: "office",
    memoryEnabled: false,
    proactiveSuggestionsEnabled: true,
    completedAt: "2026-09-22",
    uploadState: "pending",
  };
  const parsed = onboardingRecordFileSchema.parse({
    version: 1,
    deviceMid: "legacy-device",
    entries: [entry],
  });
  const { uploadState: _removed, ...preferences } = entry;
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { version: 1, entries: [preferences] });
});

test("production cleanup removes obsolete scheduler output and preserves metadata", async () => {
  const { mkdtemp, mkdir, writeFile, access, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { cleanDesktopProductionOutput } =
    await import("../../packages/desktop/scripts/run-production-build.mjs");
  const root = await mkdtemp(join(tmpdir(), "zcodium-clean-"));
  const previous = process.env.ZCODE_E2E_KEEP_BUILD_CACHE;
  delete process.env.ZCODE_E2E_KEEP_BUILD_CACHE;
  try {
    await mkdir(join(root, "out/scheduler"), { recursive: true });
    await mkdir(join(root, "out/metadata"), { recursive: true });
    await writeFile(join(root, "out/scheduler/removed-collector.js"), "obsolete");
    await writeFile(join(root, "out/metadata/build-meta.json"), "{}");
    await cleanDesktopProductionOutput({ cwd: root });
    await assert.rejects(access(join(root, "out/scheduler/removed-collector.js")), {
      code: "ENOENT",
    });
    await access(join(root, "out/metadata/build-meta.json"));
  } finally {
    if (previous === undefined) delete process.env.ZCODE_E2E_KEEP_BUILD_CACHE;
    else process.env.ZCODE_E2E_KEEP_BUILD_CACHE = previous;
    await rm(root, { recursive: true, force: true });
  }
});
