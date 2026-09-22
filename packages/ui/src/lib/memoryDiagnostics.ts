import {
  createMemoryDiagnosticsRegistry,
  createMemorySampleWriteGate,
  DiagnosticRecordSchema,
  DiagnosticMetricSchema,
  type DiagnosticRecord,
  MEMORY_SAMPLE_INTERVAL_MS,
  type MemoryDiagnosticsRegistry,
  type MemorySample,
} from "@zcode/shared";
import { logMemoryDiagnostics } from "@/logger.js";

/**
 * renderer 内存诊断计数器注册表。
 * 各缓存/store 模块在模块加载时注册纯读取 provider；`startMemoryDiagnosticsLogger` 每 60 秒
 * 采样一次，经门控后通过 `logger.logMemoryDiagnostics` 写桌面主日志。
 */
export const uiMemoryDiagnosticsRegistry: MemoryDiagnosticsRegistry =
  createMemoryDiagnosticsRegistry();

interface RendererHeapSnapshot {
  usedJSHeapSize?: number;
  totalJSHeapSize?: number;
}

/** Chromium 专有的 `performance.memory`；Web 端浏览器缺失时返回 undefined。 */
function readRendererHeapSnapshot(): RendererHeapSnapshot | undefined {
  if (typeof performance === "undefined") {
    return undefined;
  }
  const memory = (performance as Performance & { memory?: RendererHeapSnapshot }).memory;
  if (!memory || typeof memory.usedJSHeapSize !== "number") {
    return undefined;
  }
  return memory;
}

interface StartMemoryDiagnosticsLoggerOptions {
  intervalMs?: number;
  now?: () => number;
  readHeap?: () => RendererHeapSnapshot | undefined;
  write?: (record: DiagnosticRecord) => void;
  registry?: MemoryDiagnosticsRegistry;
}

interface MemoryDiagnosticsLoggerHandle {
  sampleNow(): boolean;
  stop(): void;
}

export function startMemoryDiagnosticsLogger(
  options: StartMemoryDiagnosticsLoggerOptions = {},
): MemoryDiagnosticsLoggerHandle {
  const now = options.now ?? (() => Date.now());
  const readHeap = options.readHeap ?? readRendererHeapSnapshot;
  const write = options.write ?? logMemoryDiagnostics;
  const registry = options.registry ?? uiMemoryDiagnosticsRegistry;
  const gate = createMemorySampleWriteGate();

  const sampleNow = (): boolean => {
    try {
      const heap = readHeap();
      const heapUsedKb = heap ? Math.round(heap.usedJSHeapSize! / 1024) : undefined;
      const sample: MemorySample = {
        role: "renderer",
        counters: registry.collect(),
      };
      if (heap) {
        sample.heapUsedKb = heapUsedKb;
        if (typeof heap.totalJSHeapSize === "number") {
          sample.heapTotalKb = Math.round(heap.totalJSHeapSize / 1024);
        }
      }
      const reason = gate.evaluate(sample, now());
      if (!reason) {
        return false;
      }
      const metrics: Record<string, number> = {};
      if (sample.heapUsedKb !== undefined) metrics.heapUsedBytes = sample.heapUsedKb * 1024;
      if (sample.heapTotalKb !== undefined) metrics.heapTotalBytes = sample.heapTotalKb * 1024;
      const names: Record<string, string> = {
        "sessionStore.workspaces": "sessionWorkspaceCount",
        "toolLayout.openState": "toolLayoutOpenCount",
        "shiki.tokensCache": "syntaxTokenCacheCount",
        "shiki.highlighters": "syntaxHighlighterCount",
        "taskQueryCache.queryKeys": "taskQueryCount",
        "taskQueryCache.taskMetas": "taskMetaCount",
        "projection.stores": "projectionStoreCount",
        "projection.rows": "projectionRowCount",
        "xterm.sessions": "terminalSessionCount",
        "taskSnapshotCache.entries": "taskSnapshotCount",
        "taskSnapshotCache.persisted": "persistedTaskSnapshotCount",
      };
      const allowed = new Set<string>(DiagnosticMetricSchema.options);
      for (const [key, name] of Object.entries(names)) {
        const value = sample.counters[key];
        if (allowed.has(name) && typeof value === "number" && Number.isFinite(value))
          metrics[name] = value;
      }
      write(
        DiagnosticRecordSchema.parse({
          name: "process.resource",
          component: "renderer",
          phase: "sample",
          metrics,
        }),
      );
      return true;
    } catch {
      // 诊断采样失败只丢当前样本，不能影响渲染。
      return false;
    }
  };

  let handle: ReturnType<typeof setInterval> | undefined = setInterval(
    sampleNow,
    options.intervalMs ?? MEMORY_SAMPLE_INTERVAL_MS,
  );

  return {
    sampleNow,
    stop() {
      if (handle === undefined) {
        return;
      }
      clearInterval(handle);
      handle = undefined;
    },
  };
}
