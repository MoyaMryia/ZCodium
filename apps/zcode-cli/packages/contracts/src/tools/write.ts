// ============================================================
// Write Tool - File Writing Tool
// ============================================================
// Reference: file write input / output shape

import { z } from "zod";
import type { ToolCallId, TraceId } from "../interfaces/shared.js";
import { toToolJsonSchema } from "./json-schema.js";
import { ToolExecutionPerformanceSchema } from "./performance.js";

// -----------------------------------------------
// Input Schema
// -----------------------------------------------

export const WriteInputSchema = z.object({
  /**
   * The absolute path to the file to write.
   */
  file_path: z
    .string()
    .describe("The absolute path to the file to write (must be absolute, not relative)"),
  /**
   * The content to write to the file
   */
  content: z.string().describe("The content to write to the file"),
});

export type WriteInput = z.infer<typeof WriteInputSchema>;

export const WriteInputJsonSchema = toToolJsonSchema(WriteInputSchema);

// -----------------------------------------------
// Output Types
// -----------------------------------------------

export interface WriteOutput {
  /**
   * Whether a new file was created or an existing file was updated
   */
  type: "create" | "update";
  /**
   * The path to the file that was written
   */
  filePath: string;
  /**
   * The content that was written to the file
   */
  content: string;
  /**
   * Diff patch showing the changes
   */
  structuredPatch: DiffHunk[];
  /**
   * The original file content before the write (null for new files)
   */
  originalFile: string | null;
  /**
   * Git diff information (for remote scenarios)
   */
  gitDiff?: GitDiff;
  /**
   * True when the user edited the proposed content in the permission dialog before accepting
   */
  userModified?: boolean;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface GitDiff {
  filename: string;
  status: "modified" | "added";
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
  /**
   * GitHub owner/repo when available
   */
  repository?: string | null;
}

export const WriteDiffHunkSchema = z
  .object({
    oldStart: z.number().int(),
    oldLines: z.number().int(),
    newStart: z.number().int(),
    newLines: z.number().int(),
    lines: z.array(z.string()),
  })
  .strict();

export const WriteGitDiffSchema = z
  .object({
    filename: z.string(),
    status: z.enum(["modified", "added"]),
    additions: z.number().int(),
    deletions: z.number().int(),
    changes: z.number().int(),
    patch: z.string(),
    repository: z.string().nullable().optional(),
  })
  .strict();

export const WriteOutputSchema = z
  .object({
    type: z.enum(["create", "update"]),
    filePath: z.string(),
    content: z.string(),
    structuredPatch: z.array(WriteDiffHunkSchema),
    originalFile: z.string().nullable(),
    gitDiff: WriteGitDiffSchema.optional(),
    userModified: z.boolean().optional(),
    perf: ToolExecutionPerformanceSchema.optional(),
  })
  .strict();

export const WriteOutputJsonSchema = toToolJsonSchema(WriteOutputSchema);

// -----------------------------------------------
// Tool Call Structure
// -----------------------------------------------

export interface WriteToolCall {
  id: ToolCallId;
  name: "Write";
  input: WriteInput;
  traceId: TraceId;
  startedAt: Date;
}

export interface WriteToolResult {
  toolCallId: ToolCallId;
  output: WriteOutput;
  traceId: TraceId;
  durationMs: number;
}

// -----------------------------------------------
// Write Errors
// -----------------------------------------------

export const WriteErrorCode = {
  FILE_NOT_READ: "write_file_not_read",
  PARTIAL_READ: "write_partial_read",
  STALE_FILE: "write_stale_file",
  PERMISSION_DENIED: "write_permission_denied",
  SECRET_DETECTED: "write_secret_detected",
  IO_ERROR: "write_io_error",
  DIRECTORY_NOT_FOUND: "write_directory_not_found",
} as const;

export type WriteErrorCode = (typeof WriteErrorCode)[keyof typeof WriteErrorCode];
