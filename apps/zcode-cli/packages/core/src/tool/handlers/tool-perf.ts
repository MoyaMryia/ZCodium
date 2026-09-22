import type { CommandExecutionPerformance, ToolExecutionPerformance } from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";
import { analyzeBashCommand } from "./bash-command-parser.js";
import { BASH_COMMAND_REGISTRY } from "./generated/bash-command-registry.js";

const COMMAND_CLASSIFY_PREFIX_CHARS = 2048;
const MAX_COMMAND_IDENTITY_PARSE_CHARS = 8 * 1024;

export function roundNonNegativeMs(ms: number): number {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms));
}

export function elapsedMsSince(startedAt: number): number {
  return roundNonNegativeMs(Date.now() - startedAt);
}

export function classifyCommand(command: string): string {
  // Bugfix: Bash command 可能包含超大 heredoc/inline script，遥测分类只看有界前缀，
  // 避免为了埋点复制并扫描完整命令，也避免正文里的 "npm test" 误导命令分类。
  const normalized = command.slice(0, COMMAND_CLASSIFY_PREFIX_CHARS).trimStart().toLowerCase();
  if (!normalized) return "empty";
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test|vitest|jest)\b/u.test(normalized)) {
    return "test";
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|update|remove)\b/u.test(normalized)) {
    return "package";
  }
  if (/\bgit\b/u.test(normalized)) return "git";
  if (/\b(?:rg|grep|find|fd)\b/u.test(normalized)) return "search";
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|compile)\b/u.test(normalized)) {
    return "build";
  }
  if (/\b(?:curl|wget|gh\s+api)\b/u.test(normalized)) return "network";
  return "other";
}

export function classifySafeCommandIdentity(
  command: string,
): Pick<CommandExecutionPerformance, "count" | "name"> {
  // 类别判断已经有界，但安全命令名仍会把完整 heredoc/inline script
  // 交给 parser。遥测不能为超大命令额外制造 O(n) CPU/内存；此时宁可少一个 count。
  if (command.length > MAX_COMMAND_IDENTITY_PARSE_CHARS) {
    return { name: "other" };
  }
  const analysis = analyzeBashCommand(command);
  const commandCount = analysis.commands.length;
  if (!command.trim()) return { count: 0, name: "empty" };
  if (analysis.hasParseErrors || analysis.hasUnsupportedSyntax || analysis.hasDynamicWords) {
    return { count: commandCount, name: "other" };
  }
  if (commandCount !== 1) {
    return {
      count: commandCount,
      name: commandCount > 1 ? "compound" : "other",
    };
  }
  const executable = basename(analysis.commands[0]?.name ?? "").toLowerCase();
  return {
    count: commandCount,
    // 隐私边界：只允许公开命令表中的静态可执行文件名进入远端 Trace；
    // 自定义脚本名和无法判定的动态表达式统一降级，绝不上传原始 token。
    name: Object.hasOwn(BASH_COMMAND_REGISTRY, executable) ? executable : "other",
  };
}

export function workspaceKind(context: ToolExecutionContext): "local" | "remote" | "unknown" {
  return context.runtimeScope === "subagent" ? "unknown" : "local";
}

export function fileByteCount(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

export function readToolExecutionPerformance(
  output: unknown,
): ToolExecutionPerformance | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return undefined;
  }
  const perf = (output as { perf?: unknown }).perf;
  if (typeof perf !== "object" || perf === null || Array.isArray(perf)) {
    return undefined;
  }
  return compactToolExecutionPerformance(perf as ToolExecutionPerformance);
}

export function compactToolExecutionPerformance(
  perf: ToolExecutionPerformance,
): ToolExecutionPerformance | undefined {
  const compact: ToolExecutionPerformance = {
    ...(perf.totalMs !== undefined ? { totalMs: perf.totalMs } : {}),
    ...(perf.permissionWaitMs !== undefined ? { permissionWaitMs: perf.permissionWaitMs } : {}),
    ...(perf.detail ? { detail: perf.detail } : {}),
  };
  return Object.keys(compact).length > 0 ? compact : undefined;
}

export function mergeToolExecutionPerformance(
  ...items: (ToolExecutionPerformance | undefined)[]
): ToolExecutionPerformance | undefined {
  return compactToolExecutionPerformance(Object.assign({}, ...items));
}

export function attachToolExecutionPerformance<T extends object>(
  output: T,
  perf: ToolExecutionPerformance | undefined,
): T {
  if (!perf) return output;
  Object.defineProperty(output, "perf", {
    configurable: true,
    enumerable: false,
    value: perf,
    writable: true,
  });
  return output;
}

function basename(value: string): string {
  return value.split(/[\\/]/u).at(-1) ?? "";
}
