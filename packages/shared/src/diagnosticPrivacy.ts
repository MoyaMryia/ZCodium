import {
  DiagnosticMetricSchema,
  DiagnosticRecordSchema,
  parseDiagnosticRecord,
} from "./diagnostics.js";
import {
  diagnosticMessages,
  diagnosticPrefixes,
  diagnosticModules,
} from "./diagnosticLogCatalog.js";

const messages = new Set(diagnosticMessages);
const numericKeys = new Set<string>(DiagnosticMetricSchema.options);
const modules = new Set(diagnosticModules);
const prefixes = [...diagnosticPrefixes].sort((a, b) => b.length - a.length);
const enumFields = new Set([
  "component",
  "status",
  "phase",
  "stage",
  "transport",
  "errorCategory",
  "errorCode",
]);
const fixedValues = new Set([
  "main",
  "host",
  "scheduler",
  "renderer",
  "agent",
  "mcp",
  "tool",
  "server",
  "ok",
  "error",
  "cancelled",
  "timeout",
  "unknown",
  "start",
  "end",
  "sample",
  "summary",
  "checkpoint",
  "http",
  "rpc",
  "stdio",
  "websocket",
  "auth",
  "permission",
  "network",
  "protocol",
  "runtime",
  "quota",
  "overload",
  "storage",
  "crash",
  "memory",
  "validation",
  "provider",
]);
const errorNames = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "AbortError",
  "AggregateError",
]);

/** 返回应用源码内位置，不保留错误消息、用户安装路径、函数名或第三方路径。 */
export function safeDiagnosticFrames(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  const result: string[] = [];
  for (const line of stack.split("\n").slice(0, 32)) {
    const normalized = line.replaceAll("\\", "/");
    const match = /((?:apps\/zcode-cli\/|packages\/)[^\s():]+):(\d+):(\d+)/.exec(normalized);
    if (match && modules.has(match[1]!)) result.push(`${match[1]}:${match[2]}:${match[3]}`);
    else {
      const bundle =
        /(?:^|[/\\])((?:main|host|scheduler|preload)\/index\.js|zcode\.cjs):(\d+):(\d+)/.exec(
          normalized,
        );
      if (bundle) result.push(`${bundle[1]}:${bundle[2]}:${bundle[3]}`);
      else {
        // Renderer 的构建 hash 不是源码路径：保留行列，不把可能由用户控制的文件名写出。
        const renderer = /(?:assets\/[^\s/():]+\.js|renderer-bundle\.js):(\d+):(\d+)/.exec(
          normalized,
        );
        if (renderer) result.push(`renderer-bundle.js:${renderer[1]}:${renderer[2]}`);
      }
    }
    if (result.length === 12) break;
  }
  return result;
}

function safeString(value: string): string {
  if (messages.has(value)) return value;
  // 模板只保留源码中的固定前缀，绝不尝试用正则猜测插值中哪些内容私密。
  const prefix = prefixes.find((candidate) => value.startsWith(candidate));
  return prefix ? `${prefix}[omitted]` : "[omitted]";
}

function safeValue(value: unknown): unknown {
  if (typeof value === "string") return safeString(value);
  if (!value || typeof value !== "object") return "[omitted]";
  const entries = Object.getOwnPropertyDescriptors(value);
  const parsed = parseDiagnosticRecord(value);
  if (parsed) return parsed;
  const result: Record<string, unknown> = {};
  // 普通元数据不执行 getter/toJSON，也不递归读取业务对象。
  for (const [key, descriptor] of Object.entries(entries)) {
    if (!("value" in descriptor)) continue;
    const item: unknown = descriptor.value;
    if (numericKeys.has(key) && typeof item === "number" && Number.isFinite(item))
      result[key] = item;
    else if (enumFields.has(key) && typeof item === "string" && fixedValues.has(item))
      result[key] = item;
    else if (
      key === "operation" &&
      item !== undefined &&
      DiagnosticRecordSchema.shape.operation.safeParse(item).success
    )
      result.operation = item;
    else if (
      key === "stage" &&
      item !== undefined &&
      DiagnosticRecordSchema.shape.stage.safeParse(item).success
    )
      result.stage = item;
    else if (
      (key === "code" || key === "errorCode") &&
      DiagnosticRecordSchema.shape.errorCode.safeParse(item).success &&
      item !== undefined
    )
      result.errorCode = item;
    else if (key === "stack") {
      const frames = safeDiagnosticFrames(item);
      if (frames.length) result.frames = frames;
    } else if (
      (key === "name" || key === "errorType") &&
      typeof item === "string" &&
      errorNames.has(item)
    )
      result.errorType = item;
    else if (key === "frames" && Array.isArray(item)) {
      const frames = item
        .slice(0, 12)
        .flatMap((frame) => (typeof frame === "string" ? safeDiagnosticFrames(frame) : []));
      if (frames.length) result.frames = frames;
    }
  }
  if (value instanceof Error) {
    result.errorType = errorNames.has(value.name) ? value.name : "Error";
    // V8 的 Error.stack 是惰性 getter，按源码白名单提取位置后丢弃原文。
    const frames = safeDiagnosticFrames(value.stack);
    if (frames.length) result.frames = frames;
  }
  return result;
}

/** 所有 console、文件和诊断 IPC sink 都必须在写出前调用；debug 也没有隐私例外。 */
export function safeLogArgs(args: readonly unknown[]): unknown[] {
  return args.slice(0, 32).map((value) => {
    try {
      return safeValue(value);
    } catch {
      return "[omitted]";
    }
  });
}
