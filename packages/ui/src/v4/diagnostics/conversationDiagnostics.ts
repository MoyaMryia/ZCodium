import type { ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import {
  clearStreamStallTracking,
  recordStreamChunkArrival,
  reportUiFirstToken,
  reportUiMessageComplete,
  reportUiToolCallDetail,
  reportUiTurnBreakdown,
} from "@/lib/diagnostics/uiPerformance.js";
import { recordUiDiagnostic } from "@/lib/diagnostics/recorder.js";

interface TurnTiming {
  startedAt: number;
  firstTokenMs?: number;
  toolCount: number;
  failedTools: number;
  retries: number;
  modelRequests: number;
  waitingMs: number;
  permissions: Map<string, number>;
}

/** 只拥有有界、临时的技术时序；会话业务状态仍由 Runtime/ProjectionStore 持有。 */
export class ConversationDiagnostics {
  private readonly turns = new Map<string, TurnTiming>();
  private readonly seenEvents = new Set<string>();
  private readonly streamKeys = new Set<string>();
  private readonly scope = crypto.randomUUID();

  handleFact(fact: ConversationTelemetryFact): void {
    if (this.seenEvents.has(fact.eventId)) return;
    this.seenEvents.add(fact.eventId);
    if (this.seenEvents.size > 2000) this.seenEvents.delete(this.seenEvents.values().next().value!);
    // 身份仅用于进程内匹配，永不进入日志/读取接口。
    const key = `${this.scope}\0${fact.sessionId}\0${fact.turnId ?? fact.sourceCommandId ?? ""}`;
    const turn = this.turns.get(key);
    if (fact.kind === "turn.started") {
      this.turns.set(key, {
        startedAt: fact.occurredAt,
        toolCount: 0,
        failedTools: 0,
        retries: 0,
        modelRequests: 0,
        waitingMs: 0,
        permissions: new Map(),
      });
      if (this.turns.size > 128) {
        const oldest = this.turns.keys().next().value!;
        this.turns.delete(oldest);
        clearStreamStallTracking(oldest);
        this.streamKeys.delete(oldest);
      }
      return;
    }
    if (fact.kind === "stream.chunk") {
      // 子代理片段不混入前台首字/停顿；工具期间的间隔由 lifecycle 清空。
      if (fact.parentToolCallId) return;
      if (turn && turn.firstTokenMs === undefined) {
        turn.firstTokenMs = Math.max(0, fact.occurredAt - turn.startedAt);
        reportUiFirstToken({ ttftMs: turn.firstTokenMs });
      }
      this.streamKeys.add(key);
      if (this.streamKeys.size > 128) {
        const oldest = this.streamKeys.values().next().value!;
        clearStreamStallTracking(oldest);
        this.streamKeys.delete(oldest);
      }
      recordStreamChunkArrival(key, {
        now: fact.occurredAt,
        chunkType: fact.channel === "text" ? "message" : "thought",
      });
      return;
    }
    if (fact.kind === "tool.lifecycle") {
      clearStreamStallTracking(key);
      if (turn && fact.phase === "started") turn.toolCount++;
      if (turn && fact.phase === "failed") turn.failedTools++;
      if (fact.phase === "completed" || fact.phase === "failed") {
        reportUiToolCallDetail({
          ...fact.performance,
          status: fact.phase,
          totalMs: fact.performance?.totalMs ?? fact.durationMs,
        });
      }
      return;
    }
    if (fact.kind === "permission.lifecycle" && turn) {
      const permissionKey = fact.requestId ?? fact.toolCallId;
      if (fact.phase === "requested") {
        if (turn.permissions.size < 128 && !turn.permissions.has(permissionKey))
          turn.permissions.set(permissionKey, fact.occurredAt);
      } else {
        const start = turn.permissions.get(permissionKey);
        if (start !== undefined) turn.waitingMs += Math.max(0, fact.occurredAt - start);
        turn.permissions.delete(permissionKey);
      }
      return;
    }
    if (fact.kind === "model.request.status") {
      if (turn && fact.status === "model_request_started") turn.modelRequests++;
      if (turn && fact.status === "model_retry_scheduled") turn.retries++;
      recordUiDiagnostic({
        name: "ui_model_request",
        group: "ui_perf",
        value: fact.durationMs ?? 0,
        properties: {
          status: fact.status,
          attempt_count: fact.attempt,
          retry_delay_ms: fact.delayMs,
          idle_ms: fact.idleMs,
          timeout_ms: fact.timeoutMs,
          http_status: fact.statusCode,
        },
      });
      return;
    }
    if (fact.kind === "turn.terminal") {
      const durationMs =
        fact.durationMs ?? (turn ? Math.max(0, fact.occurredAt - turn.startedAt) : 0);
      reportUiMessageComplete({ durationMs, result: fact.status });
      reportUiTurnBreakdown({
        durationMs,
        result: fact.status,
        ttftMs: turn?.firstTokenMs,
        waitingMs: turn?.waitingMs,
        toolCallTotal: fact.toolCallCount ?? turn?.toolCount,
        toolCallFailed: turn?.failedTools,
        retryCount: turn?.retries,
        agentStepCount: turn?.modelRequests,
      });
      this.turns.delete(key);
      clearStreamStallTracking(key);
      this.streamKeys.delete(key);
    }
  }

  dispose(): void {
    for (const key of this.streamKeys) clearStreamStallTracking(key);
    this.streamKeys.clear();
    this.turns.clear();
    this.seenEvents.clear();
  }
}
