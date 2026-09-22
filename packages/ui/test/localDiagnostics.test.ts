import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUiDiagnostics,
  readUiDiagnostics,
  recordUiDiagnostic,
} from "../src/lib/diagnostics/recorder.js";
import { recordInputLag, reportUiLaunchToInput } from "../src/lib/diagnostics/uiPerformance.js";
import { recordChatError } from "../src/lib/diagnostics/chatErrors.js";
import { measureOperation } from "../src/lib/diagnostics/operations.js";
import { ConversationDiagnostics } from "../src/v4/diagnostics/conversationDiagnostics.js";

test("startup preserves six stages and random diagnostic correlation without business identity", () => {
  clearUiDiagnostics();
  reportUiLaunchToInput({
    marks: { createdAt: 10, mainStart: 20, appReady: 30, loadUrl: 40 },
    rendererStart: 50,
    reactCommit: 60,
    inputReady: 70,
    sessionId: "private-launch",
  });
  const events = readUiDiagnostics();
  assert.equal(events.length, 7);
  assert.equal(events[0]?.metrics.durationMs, 60);
  assert.equal(
    events.slice(1).reduce((sum, event) => sum + (event.metrics.durationMs ?? 0), 0),
    60,
  );
  assert.ok(events.every((event) => event.traceId === events[0]?.traceId));
  assert.ok(!JSON.stringify(events).includes("private-launch"));
});

test("input timing rejects IME/programmatic/suspended updates and records real lag", () => {
  clearUiDiagnostics();
  for (const input of [
    { lagMs: 600, isComposing: true, isProgrammatic: false },
    { lagMs: 600, isComposing: false, isProgrammatic: true },
    { lagMs: 6000, isComposing: false, isProgrammatic: false },
    { lagMs: 600, isComposing: false, isProgrammatic: false },
  ])
    recordInputLag({ ...input, textLength: 12, taskId: "private-session" });
  assert.equal(readUiDiagnostics().length, 1);
  assert.equal(readUiDiagnostics()[0]?.metrics.inputLagMs, 600);
  assert.ok(!JSON.stringify(readUiDiagnostics()).includes("private-session"));
});

test("visible errors preserve cause without error text, stack, endpoint or arbitrary attributes", () => {
  clearUiDiagnostics();
  recordChatError({
    error: {
      code: "NETWORK_ERROR",
      message: "ECONNRESET https://private.example /private/project secret",
      taskId: "private-session",
      traceId: "private-trace",
    },
    displayMessage: "Connection failed",
  });
  assert.equal(readUiDiagnostics()[0]?.errorCategory, "network");
  recordUiDiagnostic({
    name: "ui_chat_error",
    group: "ui_error",
    value: 1,
    properties: {
      failure_reason: "private-secret",
      url: "https://private.example",
      prompt: "private-prompt",
      duration_ms: Number.POSITIVE_INFINITY,
    },
  });
  const serialized = JSON.stringify(readUiDiagnostics());
  assert.ok(!serialized.includes("private"));
  assert.equal(readUiDiagnostics()[1]?.errorCategory, "unknown");
});

test("technical operation timing preserves returned values and original rejection", async () => {
  clearUiDiagnostics();
  const result = { private: "business result" };
  assert.equal(await measureOperation("settings", async () => result), result);
  const failure = new Error("private failure");
  await assert.rejects(
    measureOperation("command", async () => {
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(
    readUiDiagnostics().map((record) => record.status),
    ["ok", "error"],
  );
  assert.ok(!JSON.stringify(readUiDiagnostics()).includes("private"));
});

test("local facts preserve first token, turn timing, deduplication and terminal cleanup", () => {
  clearUiDiagnostics();
  const observer = new ConversationDiagnostics();
  const base = { version: 1 as const, sessionId: "private-session", turnId: "private-turn" };
  observer.handleFact({
    ...base,
    kind: "turn.started",
    eventId: "start",
    eventSeq: 0,
    occurredAt: 100,
  });
  const chunk = {
    ...base,
    kind: "stream.chunk" as const,
    eventId: "chunk",
    eventSeq: 1,
    occurredAt: 160,
    channel: "text" as const,
    chunkLength: 7,
    firstChunk: true,
  };
  observer.handleFact(chunk);
  observer.handleFact(chunk);
  observer.handleFact({
    ...base,
    kind: "turn.terminal",
    eventId: "terminal",
    eventSeq: 2,
    occurredAt: 200,
    status: "success",
  });
  assert.equal(readUiDiagnostics().filter((record) => record.stage === "first_token").length, 1);
  assert.equal(
    readUiDiagnostics().find((record) => record.stage === "first_token")?.metrics.durationMs,
    60,
  );
  assert.equal(
    readUiDiagnostics().find((record) => record.phase === "summary")?.metrics.durationMs,
    100,
  );
  assert.ok(!JSON.stringify(readUiDiagnostics()).includes("private"));
  observer.dispose();
});

test("development diagnostic history is bounded and returns copies", () => {
  clearUiDiagnostics();
  for (let count = 0; count < 250; count++)
    recordUiDiagnostic({ name: "ui_long_task", group: "ui_perf", value: count });
  assert.equal(readUiDiagnostics().length, 200);
  const record = readUiDiagnostics()[0]!;
  record.metrics.durationMs = -1;
  assert.notEqual(readUiDiagnostics()[0]?.metrics.durationMs, -1);
});

test("production logger filters arbitrary data before desktop IPC and preserves safe metrics", async () => {
  const { logger } = await import("../src/logger.js");
  const originalEnv = process.env.NODE_ENV;
  const previousWindow = globalThis.window;
  const calls: unknown[][] = [];
  process.env.NODE_ENV = "production";
  Object.assign(globalThis, {
    window: { zcode: { log: (_level: string, args: unknown[]) => calls.push(args) } },
  });
  try {
    logger.lifecycle.error("private-content", {
      message: "private-error",
      path: "/private/file",
      sessionId: "private-session",
      durationMs: 42,
      statusCode: 500,
    });
    assert.equal(calls.length, 1);
    assert.ok(!JSON.stringify(calls).includes("private"));
    assert.deepEqual(calls[0]?.[1], { durationMs: 42, statusCode: 500 });
  } finally {
    process.env.NODE_ENV = originalEnv;
    Object.assign(globalThis, { window: previousWindow });
  }
});

test("platform diagnostic reporter receives only the strict safe record and cannot break commands", async () => {
  const { setUiDiagnosticReporter } = await import("../src/lib/diagnostics/recorder.js");
  const emitted: unknown[] = [];
  setUiDiagnosticReporter((record) => emitted.push(record));
  try {
    recordUiDiagnostic({
      name: "ui_operation",
      group: "ui_perf",
      value: 11,
      properties: {
        stage: "command",
        status: "success",
        task_id: "private-id",
        message: "private-message",
      },
    });
    assert.equal(emitted.length, 1);
    assert.ok(!JSON.stringify(emitted).includes("private"));
    setUiDiagnosticReporter(() => {
      throw new Error("diagnostic sink failed");
    });
    assert.equal(await measureOperation("command", async () => 42), 42);
  } finally {
    setUiDiagnosticReporter(null);
  }
});

test("memory samples preserve fixed cache counters and gate unchanged samples without arbitrary names", async () => {
  const { startMemoryDiagnosticsLogger } = await import("../src/lib/memoryDiagnostics.js");
  const { createMemoryDiagnosticsRegistry } = await import("@zcode/shared");
  const registry = createMemoryDiagnosticsRegistry();
  registry.register("projection", () => ({ stores: 2, rows: 5 }));
  registry.register("private-project", () => ({ privateContent: 123 }));
  const samples: Array<{ metrics: Record<string, number | undefined> }> = [];
  const handle = startMemoryDiagnosticsLogger({
    registry,
    now: () => 0,
    readHeap: () => ({ usedJSHeapSize: 1024, totalJSHeapSize: 2048 }),
    write: (record) => samples.push(record),
  });
  try {
    assert.equal(handle.sampleNow(), true);
    assert.equal(handle.sampleNow(), false);
    assert.equal(samples[0]?.metrics.heapUsedBytes, 1024);
    assert.equal(samples[0]?.metrics.projectionStoreCount, 2);
    assert.equal(samples[0]?.metrics.projectionRowCount, 5);
    assert.ok(!JSON.stringify(samples).includes("private"));
  } finally {
    handle.stop();
  }
});
