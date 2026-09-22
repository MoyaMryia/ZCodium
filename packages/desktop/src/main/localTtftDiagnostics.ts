import {
  createDiagnosticTraceId,
  createDiagnosticSpanId,
  localTtftBatchSchema,
  LOCAL_TTFT_TTL_MS,
  type DiagnosticRecordInput,
} from "@zcode/shared";
import { LocalTtftExportDedupe } from "./localTtftExportDedupe.js";
/** 临时观察key只在owner内去重，记录使用随机诊断trace及固定阶段。 */
export function createLocalTtftDiagnostics(options: {
  now?: () => number;
  logger: { debug(...args: unknown[]): void };
  onRecord?: (record: DiagnosticRecordInput) => void;
}) {
  const now = options.now ?? Date.now;
  const dedupe = new LocalTtftExportDedupe(now);
  const traces = new Map<
    string,
    { traceId: string; rootId: string; start: number; sequence: number }
  >();
  const emit = (record: DiagnosticRecordInput) => {
    if (options.onRecord) options.onRecord(record);
    else options.logger.debug("[local-ttft]", record);
  };
  return {
    record(input: unknown): void {
      let serialized: string;
      try {
        serialized = JSON.stringify(input);
      } catch {
        return;
      }
      if (!serialized || Buffer.byteLength(serialized) > 256 * 1024) return;
      const parsed = localTtftBatchSchema.safeParse(input);
      if (!parsed.success) return;
      for (const [key, trace] of traces)
        if (now() - trace.start > LOCAL_TTFT_TTL_MS) traces.delete(key);
      for (const record of parsed.data.records) {
        const remember = dedupe.admit(
          parsed.data.rendererInstanceId,
          record.observationId,
          record.start,
        );
        if (!remember?.(`${record.kind}:${record.checkpointId ?? ""}`)) continue;
        const key = `${parsed.data.rendererInstanceId}:${record.observationId}`;
        let trace = traces.get(key);
        if (!trace) {
          if (traces.size >= 1024) continue;
          trace = {
            traceId: createDiagnosticTraceId(),
            rootId: createDiagnosticSpanId(),
            start: record.start,
            sequence: 0,
          };
          traces.set(key, trace);
        }
        const status =
          record.outcome === "success"
            ? "ok"
            : record.outcome === "cancelled"
              ? "cancelled"
              : record.outcome === "failed"
                ? "error"
                : "unknown";
        emit({
          name: "local.ttft",
          component: "renderer",
          traceId: trace.traceId,
          spanId: trace.rootId,
          sequence: trace.sequence++,
          status,
          phase: record.kind === "start" ? "start" : "checkpoint",
          timestampUnixMs: Math.round(record.end),
          metrics: {
            durationMs: record.end - record.start,
            queueMs: record.userWaitMs,
            startTimeUnixMs: record.start,
            endTimeUnixMs: record.end,
          },
        });
        for (const interval of record.intervals) {
          if (!remember(`${interval.stage}:${interval.start}:${interval.end}`)) continue;
          emit({
            name: "local.ttft",
            component: "renderer",
            traceId: trace.traceId,
            spanId: createDiagnosticSpanId(),
            parentSpanId: trace.rootId,
            sequence: trace.sequence++,
            stage: interval.stage,
            timestampUnixMs: Math.round(interval.end),
            metrics: {
              durationMs: interval.end - interval.start,
              stageDurationMs: interval.end - interval.start,
              startTimeUnixMs: interval.start,
              endTimeUnixMs: interval.end,
            },
          });
        }
        for (const detail of record.details ?? []) {
          if (detail.end === undefined || !remember(`detail:${detail.id}:${detail.end}`)) continue;
          emit({
            name: "local.ttft",
            component: detail.source === "cli" ? "agent" : "renderer",
            traceId: trace.traceId,
            spanId: createDiagnosticSpanId(),
            parentSpanId: trace.rootId,
            sequence: trace.sequence++,
            stage: detail.stage,
            timestampUnixMs: Math.round(detail.end),
            metrics: {
              durationMs: detail.end - detail.start,
              stageDurationMs: detail.end - detail.start,
              startTimeUnixMs: detail.start,
              endTimeUnixMs: detail.end,
            },
          });
        }
      }
    },
  };
}
