import assert from "node:assert/strict";
import test from "node:test";
import type { Logger, SessionEvent } from "@zcode/contracts";
import { SessionEventType } from "@zcode/contracts";
import { createZCodeProcessResourceSampler } from "../src/process-resource-sampler.js";
import { ConversationTelemetryFactNormalizer } from "../src/zcode-protocol-v4/conversation-telemetry-facts.js";
import { logModelMilestone } from "../../adapters/src/model/runner-status.js";
import {
  createStreamDiagnostics,
  recordStreamChunkDiagnostic,
  logStreamDiagnostics,
} from "../../adapters/src/model/runner-diagnostics.js";
import { observeLocalOperation } from "../../core/src/runtime/helpers/local-operation-diagnostics.js";

function capturedLogger() {
  const records: unknown[] = [];
  const write = (...args: unknown[]) => {
    records.push(args);
  };
  return {
    records,
    logger: { info: write, debug: write, warn: write, error: write } as unknown as Logger,
  };
}

test("process CPU and memory measurement has one timer and stops cleanly", () => {
  let tick: (() => void) | undefined;
  let timerCount = 0;
  let cpu = 0;
  let time = 0n;
  const samples: Array<{ cpuCores: number; rssKb: number }> = [];
  const sampler = createZCodeProcessResourceSampler({
    onSample: (sample) => samples.push(sample),
    readCpuUsage: () => ({ user: cpu, system: 0 }),
    readMonotonicTimeNs: () => time,
    readMemoryUsage: () => ({
      rss: 4096,
      heapTotal: 2048,
      heapUsed: 1024,
      external: 0,
      arrayBuffers: 0,
    }),
    readTotalMemoryBytes: () => 1024 ** 3,
    readUptimeSeconds: () => 60,
    logicalCpuCount: 2,
    timer: {
      setInterval: (callback) => {
        timerCount += 1;
        tick = callback;
        return {};
      },
      clearInterval: () => {
        timerCount -= 1;
        tick = undefined;
      },
    },
  });
  sampler.start();
  sampler.start();
  assert.equal(timerCount, 1);
  cpu = 500_000;
  time = 1_000_000_000n;
  tick?.();
  assert.equal(samples[0]?.cpuCores, 0.5);
  assert.equal(samples[0]?.rssKb, 4);
  sampler.stop();
  sampler.stop();
  assert.equal(timerCount, 0);
});

test("stream diagnosis retains stages and counts without raw provider content", () => {
  const { logger, records } = capturedLogger();
  const diagnostics = createStreamDiagnostics();
  const secret = "PRIVATE-provider-prompt-url-token";
  recordStreamChunkDiagnostic(diagnostics, { type: secret, body: secret });
  recordStreamChunkDiagnostic(diagnostics, { type: "text-delta", text: secret });
  recordStreamChunkDiagnostic(diagnostics, { type: "finish", finishReason: "stop", body: secret });
  logModelMilestone(logger, "model_first_content", 2, 35);
  logStreamDiagnostics({
    logger,
    diagnostics,
    attempt: 2,
    durationMs: 100,
    emittedError: false,
    emittedEvent: true,
    statusContext: {
      maxAttempts: 3,
      baseURL: secret,
      modelId: secret,
      providerId: secret,
      requestId: secret,
      sessionId: secret,
    } as never,
  });
  const serialized = JSON.stringify(records);
  assert.ok(serialized.includes("model_first_content"));
  assert.ok(serialized.includes('"other":1'));
  assert.ok(serialized.includes('"textDeltaChars":' + secret.length));
  assert.ok(!serialized.includes(secret));
});

test("operation measurement preserves result, original failure and cancellation", async () => {
  const { logger, records } = capturedLogger();
  assert.equal(await observeLocalOperation(logger, "session_title_generation", async () => 42), 42);
  const failure = new Error("PRIVATE-raw-error");
  await assert.rejects(
    observeLocalOperation(logger, "workspace_generate_text", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    observeLocalOperation(
      logger,
      "goal_completion_verification",
      async () => {
        throw failure;
      },
      controller.signal,
    ),
  );
  const serialized = JSON.stringify(records);
  assert.ok(serialized.includes('"completed"'));
  assert.ok(serialized.includes('"failed"'));
  assert.ok(serialized.includes('"cancelled"'));
  assert.ok(!serialized.includes("PRIVATE-raw-error"));
});

test("conversation diagnostic facts exclude names, endpoint and raw error", () => {
  const normalizer = new ConversationTelemetryFactNormalizer();
  const secret = "PRIVATE-provider-name-url";
  const event = (type: SessionEvent["type"], payload: unknown) =>
    ({
      type,
      payload,
      sessionId: "session",
      turnId: "turn",
      id: "event",
      sequenceNumber: 1,
      timestamp: new Date(),
    }) as SessionEvent;
  const fact = normalizer.normalize(
    "session",
    event(SessionEventType.ModelNetworkStatus, {
      type: "model_request_failed",
      requestId: "request",
      providerId: secret,
      modelId: secret,
      baseURL: secret,
      transport: "http",
      attempt: 1,
      maxAttempts: 2,
      reason: "network_error",
      retryable: true,
      message: secret,
    }),
  );
  assert.ok(fact);
  assert.ok(!JSON.stringify(fact).includes(secret));
  const tool = normalizer.normalize(
    "session",
    event(SessionEventType.ToolCallScheduled, { toolCallId: "tool", toolName: secret }),
  );
  assert.equal(tool?.kind, "tool.lifecycle");
  assert.ok(!JSON.stringify(tool).includes(secret));
});

test("central logger persists only safe records and isolated diagnostic IDs", async () => {
  const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createNodeLoggerFactory } = await import("../../adapters/src/logging/index.js");
  const secret = "PRIVATE-body-url-error-id";
  const dir = await mkdtemp(join(tmpdir(), "zcodium-diagnostics-test-"));
  const exported: unknown[] = [];
  const factory = createNodeLoggerFactory({
    logDir: dir,
    onDiagnostic: (record) => exported.push(record),
  });
  try {
    const logger = factory.createLogger(secret).child({ sessionId: secret, traceId: secret });
    logger.error(secret, new Error(secret), {
      durationMs: 12,
      eventRowCount: 7,
      modelId: secret,
      command: secret,
    });
    await factory.flush();
    assert.equal(factory.getLogDir(), join(dir, "diagnostics-v1"));
    const files = await readdir(factory.getLogDir());
    const content = await readFile(join(factory.getLogDir(), files[0]!), "utf8");
    assert.ok(!content.includes(secret));
    const entry = JSON.parse(content);
    assert.equal(entry.diagnostic.metrics.durationMs, 12);
    assert.equal(entry.diagnostic.metrics.eventRowCount, 7);
    assert.match(entry.diagnostic.traceId, /^[a-f0-9]{32}$/);
    assert.match(entry.diagnostic.parentSpanId, /^[a-f0-9]{16}$/);
    assert.equal(exported.length, 1);
    await observeLocalOperation(logger, "session_title_generation", async () => 1);
    await factory.flush();
    assert.notEqual(
      (exported[0] as { spanId: string }).spanId,
      (exported[1] as { spanId: string }).spanId,
    );
    assert.equal(
      (exported[0] as { parentSpanId: string }).parentSpanId,
      (exported[1] as { parentSpanId: string }).parentSpanId,
    );
    assert.equal((exported[1] as { status: string }).status, "ok");
    assert.equal((exported[1] as { operation: string }).operation, "session_title_generation");
    assert.ok(!JSON.stringify(exported).includes(secret));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("MCP resource samples arriving after stop cannot emit or change ownership", async () => {
  const { createMcpResourceTelemetry } =
    await import("../../adapters/src/mcp/resource-telemetry.js");
  let resolveProbe!: (
    value: Map<number, Array<{ pid: number; rssKb: number; cpuTimeMs: number }>>,
  ) => void;
  let observed = 0;
  let emitted = 0;
  const sampler = createMcpResourceTelemetry({
    arch: "x64",
    platform: "linux",
    now: () => 100,
    getProcesses: () => [
      {
        instanceId: "instance",
        mcpId: "random-id",
        pid: 1,
        startedAt: 0,
        isCurrent: () => true,
        observed: () => {
          observed += 1;
        },
      },
    ],
    onResourceSamples: () => {
      emitted += 1;
    },
    processProbe: {
      reset: () => {},
      treeScope: "process_tree",
      sampleProcessTrees: () =>
        new Promise((resolve) => {
          resolveProbe = resolve;
        }),
    } as never,
  });
  const sampling = sampler.sampleNow();
  sampler.stop();
  resolveProbe(new Map([[1, [{ pid: 1, rssKb: 100, cpuTimeMs: 30 }]]]));
  await sampling;
  assert.equal(observed, 0);
  assert.equal(emitted, 0);
});

test("diagnostic files rotate with bounded size while retaining later errors", async () => {
  const { mkdtemp, readdir, readFile, rm, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { appendBoundedDiagnosticLine } =
    await import("../../adapters/src/logging/bounded-log-file.js");
  const dir = await mkdtemp(join(tmpdir(), "zcodium-log-cap-"));
  const path = join(dir, "zcode-2026-01-01.jsonl");
  const limits = { maxSegmentBytes: 10, maxSegments: 4 };
  try {
    for (let i = 0; i < 4; i += 1)
      await appendBoundedDiagnosticLine(path, "123456789\n", false, limits);
    await appendBoundedDiagnosticLine(path, "DEBUGDROP\n", true, limits);
    assert.equal(await readFile(path, "utf8"), "123456789\n");
    await appendBoundedDiagnosticLine(path, "ERRORKEEP\n", false, limits);
    assert.equal(await readFile(path, "utf8"), "ERRORKEEP\n");
    const files = await readdir(dir);
    assert.equal(files.length, 4);
    for (const name of files) assert.ok((await stat(join(dir, name))).size <= 10);
    const { cleanupLogRetention } = await import("../../adapters/src/logging/retention.js");
    const cleanup = await cleanupLogRetention({
      logDir: dir,
      now: new Date("2026-01-10T12:00:00Z"),
      retentionDays: 7,
    });
    assert.equal(cleanup.deletedFiles.length, 4);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
