import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const load = (path) =>
  tsImport(
    new URL(`../../packages/desktop/src/main/${path}.ts`, import.meta.url).href,
    import.meta.url,
  );

test("database startup diagnostics retain terminal duration without identity or paths", async () => {
  const { createDatabaseStartupDiagnostics } = await load("databaseStartupTelemetry");
  const records = [];
  const record = createDatabaseStartupDiagnostics((entry) => records.push(entry));
  const state = {
    attemptId: "private-attempt",
    startupId: "private-startup",
    phase: "starting",
    startedAt: 10,
    updatedAt: 10,
    sequence: 1,
    disk: [],
  };
  record(state);
  record({ ...state, phase: "ready", updatedAt: 40, sequence: 2 });
  record({ ...state, phase: "ready", updatedAt: 40, sequence: 2 });
  assert.equal(records.filter((r) => r.name === "startup.database" && r.status === "ok").length, 1);
  assert.equal(records.at(-1).metrics.durationMs, 30);
  assert.doesNotMatch(JSON.stringify(records), /private-/);
});

test("resource windows keep bounded local CPU and memory measurements", async () => {
  const { ProcessResourceWindowAggregator } = await load("processResourceWindowAggregator");
  const windows = new ProcessResourceWindowAggregator();
  for (const cpuPercent of [10, 30])
    windows.add({
      role: "main",
      cpuPercent,
      rssKbTotal: 200,
      rssKbMaxProcess: 200,
      processCount: 1,
      uptimeMinutes: 1,
    });
  const [sample] = windows.drain();
  assert.equal(sample.cpuPercentMean, 20);
  assert.equal(sample.rssKbTotalPeak, 200);
  assert.deepEqual(windows.drain(), []);
});

test("crash diagnostics do not enable dumps or collect page addresses", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../packages/desktop/src/main/desktopCrashCapture.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /crashReporter\.start|copyFileSync|writeFileSync|getURL\(/);
});

test("diagnostic archives exclude legacy raw text, invalid records and symlinked content", async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readSafeDiagnosticArchive } = await load("safeDiagnosticArchive");
  const root = await mkdtemp(join(tmpdir(), "safe-archive-"));
  try {
    await mkdir(join(root, "diagnostics-v1"));
    await writeFile(join(root, "private.log"), "PRIVATE secret prompt");
    await writeFile(join(root, "diagnostics-v1", "old.log"), "PRIVATE raw line");
    await writeFile(
      join(root, "diagnostics-v1", "new.jsonl"),
      JSON.stringify({
        version: 1,
        level: "info",
        timestamp: "2026-09-22T00:00:01.000Z",
        component: "host",
        traceId: "1234567890abcdef1234567890abcdef",
        sequence: 7,
        args: [{ name: "local.ttft", metrics: { durationMs: 12 } }, "PRIVATE prompt"],
        privateKey: "PRIVATE ignored",
      }) + "\n",
    );
    try {
      await symlink(join(root, "private.log"), join(root, "diagnostics-v1", "link.log"));
    } catch (error) {
      if (process.platform !== "win32" || error.code !== "EPERM") throw error;
    }
    const result = await readSafeDiagnosticArchive([join(root, "diagnostics-v1")]);
    assert.doesNotMatch(result, /PRIVATE|prompt|privateKey/);
    assert.match(result, /durationMs/);
    const saved = JSON.parse(result.trim());
    assert.equal(saved.timestamp, "2026-09-22T00:00:01.000Z");
    assert.equal(saved.component, "host");
    assert.equal(saved.sequence, 7);
    assert.equal(saved.traceId, "1234567890abcdef1234567890abcdef");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Host relay preserves safe numeric metadata without raw stream or routing identity", async () => {
  const { createHostLogRelay } = await load("hostLogRelay");
  const logs = [];
  const sink = {
    info: (...args) => logs.push(args),
    warn: (...args) => logs.push(args),
    error: (...args) => logs.push(args),
  };
  const relay = createHostLogRelay("PRIVATE workspace", sink);
  relay.onStdout("PRIVATE input prompt");
  relay.flushRawLogs();
  relay.onStructuredLog({
    level: "info",
    source: "PRIVATE",
    args: [{ name: "process.resource", metrics: { rssBytes: 2048 } }],
  });
  assert.equal(logs.at(-1)[1].metrics.rssBytes, 2048);
  assert.doesNotMatch(JSON.stringify(logs), /PRIVATE|prompt/);
});

test("network diagnostics retain counts and phase latency without interface addresses", async () => {
  const { recordNetworkObservation, flushInterfaceNetworkStats, resetNetworkTelemetryAggregator } =
    await load("networkTelemetryAggregator");
  resetNetworkTelemetryAggregator();
  recordNetworkObservation({
    transport: "http",
    interface: "https://PRIVATE.example/secret",
    durationMs: 100,
    dnsMs: 10,
    tcpMs: 20,
    tlsMs: 30,
    ttfbMs: 40,
    ok: false,
    errorKind: "timeout",
    attempt: 2,
  });
  const [record] = flushInterfaceNetworkStats();
  assert.equal(record.requestTotal, 1);
  assert.equal(record.retryCount, 1);
  assert.equal(record.dns.mean, 10);
  assert.equal(record.primaryErrorKind, "timeout");
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE|secret/);
});

test("MCP resource contract accepts random diagnostic identity instead of name-derived IDs", async () => {
  const { zcodeMcpResourceSamplesSchema } = await tsImport(
    new URL("../../packages/shared/src/zcode-protocol/index.ts", import.meta.url).href,
    import.meta.url,
  );
  const sample = {
    mcpId: "a372a7b0-9e93-4ab0-9d24-3e1368667584",
    instanceToken: "b372a7b0-9e93-4ab0-9d24-3e1368667584",
    sampledAt: 100,
    intervalMs: 300000,
    processCount: 1,
    rssKbTotal: 10,
    rssKbMaxProcess: 10,
    cpuTimeMsDelta: 1,
    uptimeMinutes: 1,
    platform: "linux",
    arch: "x64",
    logicalCpuCount: 4,
    totalMemoryGb: 8,
  };
  assert.equal(zcodeMcpResourceSamplesSchema.safeParse([sample]).success, true);
  assert.equal(
    zcodeMcpResourceSamplesSchema.safeParse([{ ...sample, mcpId: "builtin:PRIVATE-server-name" }])
      .success,
    false,
  );
});

test("memory diagnostics retain fixed leak counters and omit dynamic private keys", async () => {
  const { memorySampleToDiagnosticRecord } = await tsImport(
    new URL("../../packages/shared/src/memoryDiagnostics.ts", import.meta.url).href,
    import.meta.url,
  );
  const record = memorySampleToDiagnosticRecord({
    role: "utility_host",
    rssKb: 2,
    counters: { "taskBus.streamBatches": 5, "PRIVATE/path": 7 },
  });
  assert.equal(record.component, "host");
  assert.equal(record.metrics.rssBytes, 2048);
  assert.equal(record.metrics["taskBus.streamBatches"], 5);
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE/);
});

test("process lifecycle diagnostic contracts reject raw errors and private spawn copies", async () => {
  const { zcodeProcessDiagnosticSchema } = await tsImport(
    new URL("../../packages/shared/src/process-diagnostic.ts", import.meta.url).href,
    import.meta.url,
  );
  const diagnostic = {
    version: 1,
    errorId: "a372a7b0-9e93-4ab0-9d24-3e1368667584",
    kind: "uncaughtException",
    origin: "uncaughtException",
    errorType: "TypeError",
    errorCode: "EACCES",
    frames: ["packages/desktop/src/main/index.ts:1:2"],
    occurredAt: 1,
  };
  assert.equal(zcodeProcessDiagnosticSchema.safeParse(diagnostic).success, true);
  assert.equal(
    zcodeProcessDiagnosticSchema.safeParse({ ...diagnostic, message: "PRIVATE prompt" }).success,
    false,
  );
  assert.equal(
    zcodeProcessDiagnosticSchema.safeParse({ ...diagnostic, frames: ["/PRIVATE/home/file.ts:1:2"] })
      .success,
    false,
  );
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../packages/services/src/zcode-agent/zcodeAgentProcessManager.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /createAgentStderrTail|stderrTail:/);
});
