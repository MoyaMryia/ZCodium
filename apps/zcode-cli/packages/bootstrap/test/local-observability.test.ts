import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import type { CommandEnvelope } from "@zcode/shared/zcode-protocol-v4";
import { ConversationV4Gateway, type V4GatewayHost } from "../src/zcode-protocol-v4/v4-gateway.js";
import { AskUserQuestionInputSchema } from "../../contracts/src/tools/ask-user-question.js";
import { startProtocolMaintenance } from "../src/zcode-protocol/maintenance.js";
import type { Logger } from "@zcode/contracts";
import { LocalTtftRecorder } from "../src/zcode-protocol-v4/local-ttft.js";
import { createMcpProcessTracker } from "../../adapters/src/mcp/process-tracker.js";

function setupRecorder() {
  let now = 100;
  const recorder = new LocalTtftRecorder(() => now);
  recorder.receive(
    {
      commandId: "input-1",
      sessionId: "session-1",
      ttft: { version: 1, observationId: randomUUID() },
    } as CommandEnvelope,
    false,
  );
  const emit = (
    type: SessionEvent["type"],
    payload: unknown,
    sessionId = "session-1",
    turnId = "turn-1",
  ) => {
    now += 10;
    recorder.event(sessionId, {
      id: randomUUID(),
      sessionId,
      turnId,
      type,
      payload,
      timestamp: new Date(),
      sequenceNumber: now,
    } as SessionEvent);
  };
  return { recorder, emit };
}

test("local latency follows business events and excludes child-tool output", () => {
  const { recorder, emit } = setupRecorder();
  try {
    emit(SessionEventType.TurnStarted, { inputId: "input-1", executionStartedAt: 105 });
    emit(SessionEventType.ModelNetworkStatus, {
      type: "model_request_started",
      querySource: "main_turn",
      requestId: "request-1",
      providerId: "provider",
      modelId: "model",
      queryId: "query-1",
    });
    emit(SessionEventType.ModelStreaming, {
      kind: "text_delta",
      delta: "child",
      parentToolCallId: "tool-child",
    });
    assert.equal(recorder.forSession("session-1")?.outputAt, undefined);
    emit(SessionEventType.ModelStreaming, { kind: "text_delta", delta: "answer" });
    const result = recorder.forSession("session-1");
    assert.equal(result?.executionAt, 105);
    assert.equal(result?.requestAt, 120);
    assert.equal(result?.outputAt, 140);
    assert.equal(result?.outputKind, "text");
  } finally {
    recorder.clear();
  }
});

test("local latency preserves retry wait and terminal failure without a fact normalizer", () => {
  const { recorder, emit } = setupRecorder();
  try {
    emit(SessionEventType.TurnStarted, { inputId: "input-1" });
    emit(SessionEventType.ModelNetworkStatus, {
      type: "model_request_started",
      querySource: "main_turn",
      requestId: "request-1",
      providerId: "provider",
      modelId: "model",
    });
    emit(SessionEventType.ModelNetworkStatus, {
      type: "model_request_failed",
      querySource: "main_turn",
      requestId: "request-1",
    });
    emit(SessionEventType.ModelNetworkStatus, {
      type: "model_retry_scheduled",
      querySource: "main_turn",
      requestId: "request-1",
    });
    emit(SessionEventType.TurnComplete, {
      inputId: "input-1",
      resultType: "error_during_execution",
    });
    const result = recorder.forSession("session-1");
    assert.equal(result?.terminal, "failed");
    assert.equal(result?.details?.find((item) => item.stage === "attempt")?.outcome, "failed");
    assert.ok(result?.details?.some((item) => item.stage === "retry_wait"));
  } finally {
    recorder.clear();
  }
});

test("MCP process ownership remains available to the local resource manager", () => {
  const tracker = createMcpProcessTracker({});
  try {
    tracker.registerConnection({
      connectionId: "connection",
      isolation: "workspace",
      serverName: "plugin:example:tools",
    });
    tracker.acquireOwner({ connectionId: "connection", ownerId: "owner", sessionId: "session" });
    tracker.recordProcessStarted({ connectionId: "connection", pid: 123 });
    assert.equal(tracker.listProcesses()[0]?.pluginName, "example");
    tracker.releaseOwner({ connectionId: "connection", ownerId: "owner" });
    assert.equal(tracker.listProcesses().length, 1);
    tracker.recordProcessClosed({ connectionId: "connection" });
    assert.deepEqual(tracker.listProcesses(), []);
  } finally {
    tracker.unregisterConnection({ connectionId: "connection" });
  }
});

test("session activity follows ordered live events without topic subscribers", () => {
  const activity: Array<{ sessionId: string; state: string }> = [];
  const gateway = new ConversationV4Gateway({
    sessionExists: () => true,
    emitWireFrame: () => assert.fail("No client subscribed"),
    emitSessionActivity: (value) => activity.push(value),
  } as V4GatewayHost);
  const event = (
    id: string,
    sequenceNumber: number,
    type: SessionEvent["type"],
    payload: unknown,
  ) =>
    ({
      id,
      sequenceNumber,
      type,
      payload,
      sessionId: "session-1",
      turnId: "turn-1",
      timestamp: new Date(),
    }) as SessionEvent;
  const started = event("started", 1, SessionEventType.TurnStarted, {
    inputId: "input-1",
    turnNumber: 1,
  });
  const completed = event("completed", 2, SessionEventType.TurnComplete, {
    inputId: "input-1",
    resultType: "success",
    duration: 10,
    tokenCount: 0,
    toolCallCount: 0,
  });
  try {
    gateway.ingest("session-1", completed);
    assert.deepEqual(activity, []);
    gateway.ingest("session-1", started);
    assert.deepEqual(activity, [
      { sessionId: "session-1", state: "running" },
      { sessionId: "session-1", state: "idle" },
    ]);
    gateway.ingest("session-1", started);
    gateway.ingest("session-1", completed);
    assert.equal(activity.length, 2);
  } finally {
    gateway.dispose();
  }
});

test("CUA live permission observations deduplicate within each session", () => {
  const sessions: string[] = [];
  const gateway = new ConversationV4Gateway({
    sessionExists: () => true,
    emitWireFrame: () => {},
    emitCuaPermissionObservation: (observation) => sessions.push(observation.sessionId),
  } as V4GatewayHost);
  const event = {
    id: "shared-event-id",
    sessionId: "session-1",
    turnId: "turn-1",
    sequenceNumber: 10,
    type: SessionEventType.ToolCallResult,
    timestamp: new Date(),
    payload: {
      toolCallId: "request-access",
      result: {
        success: true,
        content: "",
        display: {
          kind: "cua",
          toolName: "request_access",
          status: "success",
          permissionStatus: {
            schemaVersion: 1,
            platform: "darwin",
            grantOwner: "test-app",
            accessibility: "denied",
            screenRecording: "granted",
          },
        },
      },
    },
  } as SessionEvent;
  try {
    // 权限 live 观察不等待 projection 的 raw sequence gap 补齐。
    gateway.ingest("session-1", event);
    gateway.ingest("session-1", event);
    gateway.ingest("session-2", { ...event, sessionId: "session-2" } as SessionEvent);
    assert.deepEqual(sessions, ["session-1", "session-2"]);
  } finally {
    gateway.dispose();
  }
});

test("question input has no analytics metadata field", () => {
  const input = {
    questions: [
      {
        question: "Choose the release format",
        header: "Format",
        options: [
          { label: "deb", description: "Linux package" },
          { label: "exe", description: "Windows installer" },
        ],
        multiSelect: false,
      },
    ],
  };
  assert.equal(AskUserQuestionInputSchema.safeParse(input).success, true);
  assert.equal(
    AskUserQuestionInputSchema.safeParse({ ...input, metadata: { source: "tracking" } }).success,
    false,
  );
});

test("protocol maintenance retains pruning and local logs with safe resource samples", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  // fake timer 不推进 hrtime；CI 执行不足 0.5ms 时会被采样器视为零间隔，必须同步两种时钟。
  let monotonicTimeNs = 0n;
  context.mock.method(process.hrtime, "bigint", () => monotonicTimeNs);
  const calls: string[] = [];
  let logged: Record<string, unknown> | undefined;
  const maintenance = startProtocolMaintenance(
    {
      rebalanceResidentSessions: () => {
        calls.push("rebalance");
      },
      pruneSessionEventStores: () => {
        calls.push("events");
      },
      pruneDetachedChildPublishers: () => {
        calls.push("publishers");
      },
      collectMemoryDiagnostics: () => ({
        sessions: 2,
        eventRows: 12,
        "v4.publishers": 1,
        privateCounterName: 99,
      }),
    },
    {
      info: (_message: string, context: Record<string, unknown>) => {
        logged = context;
        calls.push("log");
      },
    } as unknown as Logger,
    () => {
      calls.push("transport");
      throw new Error("closed IPC");
    },
  );
  try {
    monotonicTimeNs += 60_000_000_000n;
    context.mock.timers.tick(60_000);
    assert.deepEqual(calls, ["transport", "rebalance", "events", "publishers", "log"]);
    assert.equal(logged?.sessionCount, 2);
    assert.equal(logged?.eventRowCount, 12);
    assert.equal(logged?.publisherCount, 1);
    assert.ok(!JSON.stringify(logged).includes("privateCounterName"));
  } finally {
    maintenance?.stop();
  }
  monotonicTimeNs += 60_000_000_000n;
  context.mock.timers.tick(60_000);
  assert.equal(calls.length, 5);
});
