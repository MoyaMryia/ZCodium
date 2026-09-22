import { z } from "zod";

export const ToolCommandStatusSchema = z.enum([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
  "spawn_error",
  "backgrounded",
]);

export type ToolCommandStatus = z.infer<typeof ToolCommandStatusSchema>;

export const CommandExecutionPerformanceSchema = z
  .object({
    runMs: z.number().int().nonnegative().optional(),
    firstOutputMs: z.number().int().nonnegative().optional(),
    noOutputMs: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().optional(),
    timedOut: z.boolean().optional(),
    outputBytes: z.number().int().nonnegative().optional(),
    category: z.string().max(64).optional(),
    /**
     * 只允许公开 Registry 中的可执行文件名或固定低基数桶；禁止放入原始命令或参数。
     */
    name: z.string().max(128).optional(),
    count: z.number().int().nonnegative().optional(),
    status: ToolCommandStatusSchema,
  })
  .strict();

export type CommandExecutionPerformance = z.infer<typeof CommandExecutionPerformanceSchema>;

export const FileSystemExecutionPerformanceSchema = z
  .object({
    readMs: z.number().int().nonnegative().optional(),
    writeMs: z.number().int().nonnegative().optional(),
    fileCount: z.number().int().nonnegative().optional(),
    totalBytes: z.number().int().nonnegative().optional(),
    maxFileBytes: z.number().int().nonnegative().optional(),
    workspaceKind: z.enum(["local", "remote", "unknown"]).optional(),
  })
  .strict();

export type FileSystemExecutionPerformance = z.infer<typeof FileSystemExecutionPerformanceSchema>;

export const PatchExecutionPerformanceSchema = z
  .object({
    matchMs: z.number().int().nonnegative().optional(),
    hunkCount: z.number().int().nonnegative().optional(),
    matchAttempts: z.number().int().nonnegative().optional(),
  })
  .strict();

export type PatchExecutionPerformance = z.infer<typeof PatchExecutionPerformanceSchema>;

export const ToolExecutionPerformanceDetailSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("command"),
      command: CommandExecutionPerformanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("filesystem"),
      filesystem: FileSystemExecutionPerformanceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("patch"),
      filesystem: FileSystemExecutionPerformanceSchema,
      patch: PatchExecutionPerformanceSchema,
    })
    .strict(),
]);

export type ToolExecutionPerformanceDetail = z.infer<typeof ToolExecutionPerformanceDetailSchema>;

/**
 * 工具执行结果摘要，随 ToolCallResult 事件落本地存储；命令专属字段只能进入判别 detail，
 * 避免非命令工具伪造 exitCode 等不适用事实。
 */
export const ToolExecutionPerformanceSchema = z
  .object({
    totalMs: z.number().int().nonnegative().optional(),
    permissionWaitMs: z.number().int().nonnegative().optional(),
    detail: ToolExecutionPerformanceDetailSchema.optional(),
  })
  .strict();

export type ToolExecutionPerformance = z.infer<typeof ToolExecutionPerformanceSchema>;
