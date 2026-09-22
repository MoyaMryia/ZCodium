import {
  createDiagnosticTraceId,
  createDiagnosticSpanId,
  DiagnosticRecordSchema,
  type DiagnosticRecordInput,
  type DatabaseStartupState,
} from "@zcode/shared";
/** Host owns startup state; this observer only projects ordered safe measurements. */
export function createDatabaseStartupDiagnostics(record: (entry: DiagnosticRecordInput) => void) {
  type Attempt = {
    traceId: string;
    spanId: string;
    phase: DatabaseStartupState["phase"];
    databasePhase?: DatabaseStartupState["databasePhase"];
    at: number;
    sequence: number;
    terminal: boolean;
  };
  const attempts = new Map<string, Attempt>();
  return (state: DatabaseStartupState): void => {
    let attempt = attempts.get(state.attemptId);
    if (!attempt) {
      if (attempts.size >= 128) attempts.delete(attempts.keys().next().value!);
      attempt = {
        traceId: createDiagnosticTraceId(),
        spanId: createDiagnosticSpanId(),
        phase: "starting",
        at: state.startedAt,
        sequence: -1,
        terminal: false,
      };
      attempts.set(state.attemptId, attempt);
      record({
        name: "startup.database",
        component: "host",
        phase: "start",
        stage: "starting",
        traceId: attempt.traceId,
        spanId: attempt.spanId,
        metrics: { count: 1 },
      });
    }
    if (attempt.terminal || state.sequence <= attempt.sequence) return;
    attempt.sequence = state.sequence;
    if (state.phase !== attempt.phase || state.databasePhase !== attempt.databasePhase) {
      record({
        name: "startup.database",
        component: "host",
        phase: "checkpoint",
        stage: attempt.databasePhase ?? attempt.phase,
        traceId: attempt.traceId,
        spanId: createDiagnosticSpanId(),
        parentSpanId: attempt.spanId,
        sequence: state.sequence,
        metrics: { stageDurationMs: Math.max(0, state.updatedAt - attempt.at) },
      });
      attempt.phase = state.phase;
      attempt.databasePhase = state.databasePhase;
      attempt.at = state.updatedAt;
    }
    if (state.phase !== "ready" && state.phase !== "failed") return;
    attempt.terminal = true;
    const code = DiagnosticRecordSchema.shape.errorCode.safeParse(state.systemCode);
    record({
      name: "startup.database",
      component: "host",
      phase: "end",
      stage: state.phase,
      status: state.phase === "ready" ? "ok" : "error",
      errorCategory: state.phase === "failed" ? "storage" : undefined,
      errorCode: code.success ? code.data : undefined,
      traceId: attempt.traceId,
      spanId: attempt.spanId,
      sequence: state.sequence,
      metrics: {
        durationMs: Math.max(0, state.updatedAt - state.startedAt),
        sqliteCode: state.sqliteCode,
        migrationExecutedCount: state.migration?.executedCount,
        migrationCommittedCount: state.migration?.committedCount,
      },
    });
  };
}
