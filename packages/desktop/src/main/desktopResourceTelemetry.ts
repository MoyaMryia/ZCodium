import {
  bytesToKb,
  createMemorySampleWriteGate,
  memorySampleToDiagnosticRecord,
  memoryUsageToSampleFields,
  zcodeToolExecResourceSchema,
  type MemorySample,
  type MemorySampleWriteGate,
  type ProcessResourceRole,
  type ProcessResourceRuntimeSurface,
} from "@zcode/shared";
import { BrowserWindow } from "electron";
import { mainMemoryDiagnosticsRegistry } from "./mainMemoryDiagnostics.js";
import { addAppResourceTotals, type AppResourceTotals } from "./processResourceAppTotals.js";
import { PROCESS_RESOURCE_SAMPLE_SOURCES } from "./processResourceSampleSourceRegistry.js";
import {
  flushPendingProcessResourceSampleSources,
  resetProcessResourceSampleSources,
  runProcessResourceDeviceSampleSources,
  runProcessResourceSampleSources,
} from "./processResourceSampleSources.js";
import { ProcessResourceSystemWindowAggregator } from "./processResourceSystemWindowAggregator.js";
import {
  ProcessResourceWindowAggregator,
  type ProcessRoleSample,
} from "./processResourceWindowAggregator.js";
import { recordDesktopDiagnostic } from "./localDiagnosticSink.js";

const RESOURCE_SAMPLE_INTERVAL_MS = 10_000;
const RESOURCE_REPORT_INTERVAL_MS = 300_000;
const MEMORY_LOG_SAMPLE_EVERY_N_TICKS = 6;
interface ResourceLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug?(...args: unknown[]): void;
}
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let reportTimer: ReturnType<typeof setInterval> | null = null;
let memoryLogTick = 0;
let memorySampleWriteGate: MemorySampleWriteGate = createMemorySampleWriteGate();
let readTelemetrySelfClockMs = () => performance.now();
const processResourceWindows = new ProcessResourceWindowAggregator();
const processResourceSystemWindow = new ProcessResourceSystemWindowAggregator();
const recentToolExecCompletions = new Set<string>();
const MAX_RECENT_TOOL_EXEC_COMPLETIONS = 1024;
export function resolveResourceUsageScene(): "foreground" | "background" {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed());
  if (windows.length === 0) {
    return "background";
  }

  const anyFocused = windows.some((win) => win.isFocused());
  const anyVisible = windows.some((win) => win.isVisible() && !win.isMinimized());
  return anyFocused && anyVisible ? "foreground" : "background";
}

function readMainMemoryUsage(): NodeJS.MemoryUsage | null {
  try {
    return process.memoryUsage();
  } catch {
    return null;
  }
}

function logMemorySample(
  logger: ResourceLogger | undefined,
  memoryUsage: NodeJS.MemoryUsage,
  samples: readonly ProcessRoleSample[],
): void {
  if (!logger) {
    return;
  }
  try {
    const counters = mainMemoryDiagnosticsRegistry.collect();
    for (const sample of samples) {
      counters[`ws.${sample.role}`] = sample.rssKbTotal;
    }
    const sample: MemorySample = {
      role: "main",
      ...memoryUsageToSampleFields(memoryUsage),
      counters,
    };
    const reason = memorySampleWriteGate.evaluate(sample, Date.now());
    if (reason) {
      recordDesktopDiagnostic(memorySampleToDiagnosticRecord(sample));
    }
  } catch {
    // 诊断日志失败只丢当前样本，不影响资源采样与 ARMS 上报。
  }
}

function takeSample(logger?: ResourceLogger): void {
  processResourceWindows.recordScene(resolveResourceUsageScene());

  const now = Date.now();
  const samples: ProcessRoleSample[] = [];
  /**
   * 只有进程自己读得到 heap：main 在下面就地读，host / scheduler / renderer 由各自的
   * 自采样本来源投递。heap 不足以独立开窗，统一并入同一 tick 内该角色的完整样本。
   */
  const heapUsedKbByRole = new Map<ProcessResourceRole, number>();
  let appProcessTotals: AppResourceTotals | null = null;
  const onError = (): void => logger?.warn("[resource] sample source failed");
  runProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
    now,
    addRoleSample: (sample) => samples.push(sample),
    addRoleHeapSample: (role, heapUsedKb) => heapUsedKbByRole.set(role, heapUsedKb),
    addAppProcessTotals: (totals) => {
      appProcessTotals = appProcessTotals ? addAppResourceTotals(appProcessTotals, totals) : totals;
    },
    onError,
  });

  // 每 6 个 tick（≈60s）读一次 main 自身内存：同一次读数既写本地 `[memory]` 日志，
  // 又作为 main 角色事件的 heap 样本，两处数值天然一致且不新增定时器。
  memoryLogTick += 1;
  const mainMemoryUsage =
    memoryLogTick % MEMORY_LOG_SAMPLE_EVERY_N_TICKS === 0 ? readMainMemoryUsage() : null;
  if (mainMemoryUsage) {
    heapUsedKbByRole.set("main", bytesToKb(mainMemoryUsage.heapUsed));
  }

  for (const sample of samples) {
    const heapUsedKb = heapUsedKbByRole.get(sample.role);
    processResourceWindows.add(heapUsedKb === undefined ? sample : { ...sample, heapUsedKb });
  }

  if (mainMemoryUsage) {
    logMemorySample(logger, mainMemoryUsage, samples);
  }

  // 第二阶段：设备级来源要用同一 tick 的精确合计，所以必须等第一阶段全部来源跑完。
  runProcessResourceDeviceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
    now,
    appProcessTotals,
    addDeviceSample: (sample) => processResourceSystemWindow.add(sample),
    onError,
  });
}

/**
 * main 侧采样器自身的墙钟耗时计入本地资源窗口。
 * flush 的耗时落在下一个窗口——它发生在窗口投影之后，无法计入已经发出的那条事件。
 */
function measureTelemetrySelfMs(run: () => void): void {
  const startedAt = readTelemetrySelfClockMs();
  try {
    run();
  } finally {
    processResourceSystemWindow.addTelemetrySelfMs(readTelemetrySelfClockMs() - startedAt);
  }
}

function drainAllResourceWindows(): void {
  const backgroundRatio = processResourceWindows.backgroundRatio;
  for (const report of processResourceWindows.drain()) {
    recordDesktopDiagnostic({
      version: 1,
      name: "process.resource",
      processRole: report.role,
      component:
        report.role === "main"
          ? "main"
          : report.role === "host"
            ? "host"
            : report.role === "scheduler"
              ? "scheduler"
              : report.role === "mcp"
                ? "mcp"
                : report.role.startsWith("cli")
                  ? "agent"
                  : "renderer",
      metrics: {
        cpuPercentMean: report.cpuPercentMean,
        cpuPercentP95: report.cpuPercentP95,
        cpuPercentPeak: report.cpuPercentPeak,
        rssKbMean: report.rssKbTotalMean,
        rssKbPeak: report.rssKbTotalPeak,
        heapUsedKbMean: report.heapUsedKbMean,
        heapUsedKbPeak: report.heapUsedKbPeak,
        processCount: report.processCountPeak,
        sampleCount: report.sampleCount,
      },
    });
  }
  const report = processResourceSystemWindow.drain({
    backgroundRatio,
    appUptimeMinutes: Math.round(process.uptime() / 60),
  });
  if (report)
    recordDesktopDiagnostic({
      version: 1,
      name: "system.resource",
      component: "main",
      metrics: {
        cpuPercentP95: report.systemCpuPercentP95,
        rssKbMean: report.appRssKbTotalMean,
        rssKbPeak: report.appRssKbTotalPeak,
        bytes: report.systemFreeMemoryKbMin * 1024,
        processCount: report.processCountTotalPeak,
        sampleCount: report.sampleCount,
      },
    });
}
export function ingestToolExecResource(
  raw: unknown,
  _runtimeSurface: ProcessResourceRuntimeSurface,
): void {
  const parsed = zcodeToolExecResourceSchema.safeParse(raw);
  if (!parsed.success) return;
  const sample = parsed.data;
  if (sample.completionToken) {
    if (recentToolExecCompletions.has(sample.completionToken)) return;
    recentToolExecCompletions.add(sample.completionToken);
    if (recentToolExecCompletions.size > MAX_RECENT_TOOL_EXEC_COMPLETIONS)
      recentToolExecCompletions.delete(recentToolExecCompletions.values().next().value!);
  }
  recordDesktopDiagnostic({
    version: 1,
    name: "tool.resource",
    component: "tool",
    metrics: {
      durationMs: sample.durationMs,
      sampleCount: sample.sampleCount,
      rssKbPeak: sample.treeRssKbPeak ?? sample.cliRssKb,
      cpuTimeMs: sample.treeCpuTimeMs,
      bytes: sample.systemFreeMemoryKb * 1024,
    },
  });
}
export function registerDesktopResourceTelemetry(
  logger: ResourceLogger,
  options?: { reportIntervalMs?: number; readSelfClockMs?: () => number },
): void {
  stopDesktopResourceTelemetry();
  memoryLogTick = 0;
  memorySampleWriteGate = createMemorySampleWriteGate();
  resetProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES);
  readTelemetrySelfClockMs = options?.readSelfClockMs ?? (() => performance.now());
  sampleTimer = setInterval(
    () =>
      measureTelemetrySelfMs(() => {
        try {
          takeSample(logger);
        } catch {
          logger.warn("[resource] sample failed");
        }
      }),
    RESOURCE_SAMPLE_INTERVAL_MS,
  );
  reportTimer = setInterval(
    () => measureTelemetrySelfMs(drainAllResourceWindows),
    options?.reportIntervalMs ?? RESOURCE_REPORT_INTERVAL_MS,
  );
  sampleTimer.unref();
  reportTimer.unref();
}
export function stopDesktopResourceTelemetry(options?: { flushPendingWindows?: boolean }): void {
  if (sampleTimer) clearInterval(sampleTimer);
  if (reportTimer) clearInterval(reportTimer);
  sampleTimer = reportTimer = null;
  if (options?.flushPendingWindows) {
    // 退出仅排空已有事实，不能再启动探针或磁盘扫描。
    flushPendingProcessResourceSampleSources(PROCESS_RESOURCE_SAMPLE_SOURCES, {
      now: Date.now(),
      addRoleSample: (sample) => processResourceWindows.add(sample),
      addRoleHeapSample: () => {},
      addAppProcessTotals: () => {},
      onError: () => {},
    });
    drainAllResourceWindows();
  }
  processResourceWindows.clear();
  processResourceSystemWindow.clear();
  recentToolExecCompletions.clear();
}
