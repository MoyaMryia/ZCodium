import { summarizeLongTaskAttribution } from "@zcode/shared";
import { recordUiDiagnostic } from "@/lib/diagnostics/recorder.js";

/** 只读取数值与固定 invoker 类别，不读取脚本 URL、函数参数或 DOM 内容。 */
export function observeLongTasks(): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  const type = PerformanceObserver.supportedEntryTypes.includes("long-animation-frame")
    ? "long-animation-frame"
    : PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? "longtask"
      : null;
  if (!type) return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const scripts = (
        entry as PerformanceEntry & { scripts?: Array<{ duration?: number; invokerType?: string }> }
      ).scripts;
      const safeScripts = scripts?.slice(0, 5).map((script) => ({
        duration: script.duration,
        invokerType:
          script.invokerType === "user-callback" || script.invokerType === "event-listener"
            ? script.invokerType
            : "unknown",
      }));
      const summary = summarizeLongTaskAttribution(
        safeScripts ? JSON.stringify(safeScripts) : undefined,
        entry.duration,
      );
      recordUiDiagnostic({
        name: "ui_long_task",
        group: "ui_perf",
        value: entry.duration,
        properties: summary ? { ...summary } : undefined,
      });
    }
  });
  observer.observe({ type, buffered: false });
  return () => observer.disconnect();
}
