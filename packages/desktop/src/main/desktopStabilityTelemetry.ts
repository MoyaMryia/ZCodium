import { safeLogArgs } from "@zcode/shared";
import { logger } from "./logger.js";
import { BrowserWindow, type WebContents } from "electron";
import type {
  HostAgentProcessErrorResponse,
  HostAgentProcessExceptionResponse,
  HostAgentProcessExitedResponse,
  HostAgentProcessReadyResponse,
  HostAgentProcessSpawnedResponse,
} from "@zcode/shared";
import { registerCrashEventMonitor } from "./desktopCrashCapture.js";
import { recordDesktopDiagnostic } from "./localDiagnosticSink.js";
type Scene = "cold_start" | "runtime" | "app_quit" | "update_install";
let lifecycleScene: Scene = "runtime";
const exceptions = new Set<string>();
const watched = new Set<number>();
export function notifyStabilityLifecycle(scene: Scene): void {
  lifecycleScene = scene;
}
export function getStabilityLifecycleScene(): Scene {
  return lifecycleScene;
}
export function notifyStabilityAppExit(scene: Scene): void {
  lifecycleScene = scene;
  recordDesktopDiagnostic({
    name: "process_exit",
    component: "main",
    stage: "shutdown",
    status: "ok",
  });
}
export function recordAgentProcessStarted(_event: HostAgentProcessSpawnedResponse): void {
  recordDesktopDiagnostic({
    name: "runtime",
    component: "agent",
    stage: "spawn",
    phase: "start",
    metrics: { count: 1 },
  });
}
export function recordAgentProcessReady(event: HostAgentProcessReadyResponse): void {
  recordDesktopDiagnostic({
    name: "startup",
    component: "agent",
    stage: "ready",
    status: "ok",
    metrics: { durationMs: event.startupDurationMs },
  });
}
export function recordAgentProcessExited(event: HostAgentProcessExitedResponse): void {
  if (
    event.terminationKind !== "unexpected" ||
    lifecycleScene === "app_quit" ||
    lifecycleScene === "update_install"
  )
    return;
  // 结构化协议故障优先于最终回收信号；普通受控 SIGTERM 不应被计为崩溃。
  if (
    event.terminationReason !== "protocol-close" &&
    (event.exitCode === 0x40010004 || event.signal === "SIGTERM")
  )
    return;
  recordDesktopDiagnostic({
    name: "process.crash",
    component: "agent",
    status: "error",
    errorCategory: event.terminationReason === "protocol-close" ? "protocol" : "crash",
    metrics: { exitCode: event.exitCode ?? undefined, uptimeMs: event.uptimeMs },
  });
}
export function recordAgentProcessError(event: HostAgentProcessErrorResponse): void {
  logger.error(
    "[agent] spawn failed",
    ...safeLogArgs([{ frames: event.frames, errorCode: event.errorCode }]),
  );
  recordDesktopDiagnostic({
    name: "process.crash",
    component: "agent",
    stage: "spawn",
    status: "error",
    errorCategory: "runtime",
  });
}
export function recordAgentProcessException(event: HostAgentProcessExceptionResponse): void {
  const key = `${event.runtimeInstanceId}:${event.diagnostic.errorId}`;
  if (exceptions.has(key)) return;
  exceptions.add(key);
  logger.error("[agent] exception", ...safeLogArgs([event.diagnostic]));
  if (exceptions.size > 1024) exceptions.delete(exceptions.values().next().value!);
  recordDesktopDiagnostic({
    name: "error",
    component: "agent",
    status: "error",
    errorCategory: "runtime",
    metrics: { count: 1 },
  });
}
function watch(contents: WebContents): void {
  if (watched.has(contents.id)) return;
  watched.add(contents.id);
  let started = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let anr = false;
  let freeze = false;
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };
  contents.on("unresponsive", () => {
    if (timer) return;
    started = performance.now();
    anr = false;
    freeze = false;
    timer = setInterval(() => {
      const durationMs = performance.now() - started;
      if ((!anr && durationMs >= 5000) || (!freeze && durationMs >= 30000)) {
        if (durationMs >= 30000) freeze = true;
        else anr = true;
        recordDesktopDiagnostic({
          name: "process.unresponsive",
          component: "renderer",
          status: "timeout",
          metrics: { durationMs },
        });
      }
    }, 1000);
    timer.unref();
  });
  contents.on("responsive", () => {
    if (timer)
      recordDesktopDiagnostic({
        name: "process.unresponsive",
        component: "renderer",
        status: "ok",
        metrics: { durationMs: performance.now() - started },
      });
    stop();
  });
  contents.on("render-process-gone", stop);
  contents.once("destroyed", () => {
    stop();
    watched.delete(contents.id);
  });
}
export function registerStabilityMainWindow(win: BrowserWindow): void {
  if (!win.isDestroyed()) watch(win.webContents);
}
export function registerDesktopStabilityMonitors(
  logger: Parameters<typeof registerCrashEventMonitor>[0],
): void {
  registerCrashEventMonitor(logger, {
    onBrowserWindowCreated: (win) => watch(win.webContents),
    onRenderProcessGone: (_contents, details) => {
      if (!["clean-exit", "killed"].includes(details.reason))
        recordDesktopDiagnostic({
          name: "process.crash",
          component: "renderer",
          status: "error",
          errorCategory: ["oom", "memory-eviction"].includes(details.reason) ? "memory" : "crash",
          metrics: { exitCode: details.exitCode },
        });
    },
    onChildProcessGone: (details) =>
      recordDesktopDiagnostic({
        name: "process_exit",
        component: details.serviceName?.startsWith("zcode-host") ? "host" : "main",
        status: ["clean-exit", "killed"].includes(details.reason) ? "ok" : "error",
        metrics: { exitCode: details.exitCode },
      }),
  });
  for (const win of BrowserWindow.getAllWindows()) watch(win.webContents);
}
