import { Console } from "node:console";
import { safeDiagnosticFrames, safeLogArgs } from "@zcode/shared";

/**
 * 为 CLI 的第三方 console 安装安全诊断边界；正常命令结果使用独立 stdout writer。
 *
 * app-server/agent-server 的 stdout 只能承载 ZCode Protocol NDJSON 帧，但三方
 * SDK 可能通过 console.* 写普通文本。如果不在加载这些依赖之前分离输出，
 * 任意一行日志都会被 Host 当作 JSON 解析，或直接覆盖 TUI 当前光标处的画面。
 */
export function installStderrConsoleBoundary(stderr: NodeJS.WritableStream): () => void {
  const originalConsole = globalThis.console;
  const diagnosticConsole = new Console({ stdout: stderr, stderr });
  // 三方 console 也属于诊断出口；先净化再格式化，不能让对象检查或插值泄露正文。
  for (const method of [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "dir",
    "dirxml",
    "table",
    "group",
    "groupCollapsed",
    "count",
    "countReset",
    "time",
    "timeLog",
    "timeEnd",
  ] as const) {
    const original = diagnosticConsole[method].bind(diagnosticConsole) as (
      ...args: unknown[]
    ) => void;
    Object.defineProperty(diagnosticConsole, method, {
      value: (...args: unknown[]) => original(...safeLogArgs(args)),
      configurable: true,
    });
  }
  diagnosticConsole.trace = (...args: unknown[]) => {
    // Console.trace 自行生成的绝对栈同样会泄露安装路径，改用源码白名单位置。
    diagnosticConsole.error(...args, { frames: safeDiagnosticFrames(new Error().stack) });
  };
  diagnosticConsole.assert = (condition: unknown, ...args: unknown[]) => {
    if (!condition) diagnosticConsole.error(...args);
  };
  globalThis.console = diagnosticConsole;

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    globalThis.console = originalConsole;
  };
}
