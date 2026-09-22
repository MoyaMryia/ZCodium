import { app, type BrowserWindow, type WebContents } from "electron";
interface CrashCaptureLogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
interface CrashEventMonitorHooks {
  onRenderProcessGone?: (
    contents: WebContents,
    details: { reason: string; exitCode: number },
  ) => void;
  onChildProcessGone?: (details: {
    type: string;
    reason: string;
    exitCode: number;
    serviceName?: string;
    name?: string;
  }) => void;
  onBrowserWindowCreated?: (win: BrowserWindow) => void;
}
let registered = false;
/** 原本地 dump 也会保存进程内存，关闭上传不足以满足隐私边界；只观察固定生命周期事实。 */
export function registerCrashEventMonitor(
  logger: CrashCaptureLogger,
  hooks?: CrashEventMonitorHooks,
): void {
  if (registered) return;
  registered = true;
  app.on("render-process-gone", (_event, contents, details) => {
    logger.warn("[crash] renderer exited", { exitCode: details.exitCode });
    hooks?.onRenderProcessGone?.(contents, details);
  });
  app.on("child-process-gone", (_event, details) => {
    logger.warn("[crash] child exited", { exitCode: details.exitCode });
    hooks?.onChildProcessGone?.(details);
  });
  app.on("browser-window-created", (_event, win) => {
    hooks?.onBrowserWindowCreated?.(win);
    if (!hooks?.onBrowserWindowCreated)
      win.webContents.on("unresponsive", () => logger.warn("[crash] renderer unresponsive"));
  });
}
