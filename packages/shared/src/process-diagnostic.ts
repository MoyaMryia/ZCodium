import { z } from "zod";
import { DiagnosticRecordSchema } from "./diagnostics.js";
import { safeDiagnosticFrames } from "./diagnosticPrivacy.js";

// 启动早期或协议故障时 stdout 尚不可用，进程诊断使用独立的 stderr 单行契约。
export const ZCODE_PROCESS_DIAGNOSTIC_PREFIX = "[zcode-process-exception] ";
export const ZCODE_PROCESS_DIAGNOSTIC_MAX_LINE_CHARS = 128 * 1024;
export const ZCODE_AGENT_LIFECYCLE_LOG_MARKER = "[zcode-agent-lifecycle-reported]";

const processErrorKindSchema = z.enum(["uncaughtException", "unhandledRejection"]);
export const zcodeProcessDiagnosticSchema = z
  .object({
    version: z.literal(1),
    errorId: z.uuid(),
    kind: processErrorKindSchema,
    origin: processErrorKindSchema,
    errorType: z.enum([
      "Error",
      "TypeError",
      "RangeError",
      "ReferenceError",
      "SyntaxError",
      "URIError",
      "EvalError",
      "AggregateError",
    ]),
    errorCode: DiagnosticRecordSchema.shape.errorCode,
    frames: z
      .array(
        z
          .string()
          .max(512)
          .refine((frame) => safeDiagnosticFrames(frame).includes(frame)),
      )
      .max(12),
    occurredAt: z.number().int().nonnegative(),
  })
  .strict();
export type ZCodeProcessDiagnostic = z.infer<typeof zcodeProcessDiagnosticSchema>;

export function parseZCodeProcessDiagnostic(line: string): ZCodeProcessDiagnostic | undefined {
  if (
    !line.startsWith(ZCODE_PROCESS_DIAGNOSTIC_PREFIX) ||
    line.length > ZCODE_PROCESS_DIAGNOSTIC_MAX_LINE_CHARS
  ) {
    return undefined;
  }
  try {
    const result = zcodeProcessDiagnosticSchema.safeParse(
      JSON.parse(line.slice(ZCODE_PROCESS_DIAGNOSTIC_PREFIX.length)),
    );
    return result.success ? result.data : undefined;
  } catch {
    // 诊断旁路不得因损坏帧中断业务协议或退出处理。
    return undefined;
  }
}
