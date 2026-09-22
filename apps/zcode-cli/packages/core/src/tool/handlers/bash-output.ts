import {
  type BashInput,
  type BashOutput,
  type ToolCommandStatus,
  type ExecutionResult,
  type ToolExecutionPerformance,
} from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";
import { appendBashCwdStderrSuffix } from "./bash-cwd-policy.js";
import { getGhRateLimitHint } from "./bash-gh-rate-limit.js";
import { prepareBashImageOutput } from "./bash-image-output.js";
import {
  interpretBashReturnCode,
  isBashProviderErrorStatus,
  isSilentBashCommand,
} from "./bash-semantics.js";
import {
  attachToolExecutionPerformance,
  classifyCommand,
  classifySafeCommandIdentity,
  compactToolExecutionPerformance,
  roundNonNegativeMs,
} from "./tool-perf.js";

export interface BashProgressTiming {
  firstOutputMs?: number;
}

export async function toBashOutput(
  result: ExecutionResult,
  input: BashInput,
  context: ToolExecutionContext,
  options: { progressTiming?: BashProgressTiming; stderrSuffix?: string } = {},
): Promise<BashOutput> {
  const stdoutPersistedOutputPath = result.stdout.artifactPath;
  const stderrPersistedOutputPath = result.stderr.artifactPath;
  const persistedOutputPath = stdoutPersistedOutputPath ?? stderrPersistedOutputPath;
  const stdoutPersistedOutputSize = result.stdout.artifactBytes;
  const stderrPersistedOutputSize = result.stderr.artifactBytes;
  // artifactBytes 是 64MiB cap 后的实际文件大小，不是模型可见文案中的
  // 原始观测大小。Bash persisted-output 必须使用截断前的 stream bytes。
  const persistedOutputSize = persistedOutputPath
    ? (stdoutPersistedOutputPath ? result.stdout.bytes : 0) +
      (stderrPersistedOutputPath ? result.stderr.bytes : 0)
    : undefined;
  const stderr = appendBashCwdStderrSuffix(
    result.stderr.text || result.error?.message || "",
    options.stderrSuffix,
  );
  const returnCodeInterpretation = interpretBashReturnCode(input.command, result);
  const providerError = isBashProviderErrorStatus({
    exitCode: result.exitCode,
    returnCodeInterpretation,
    status: result.status,
  });
  const providerStdout = result.stdout.text;
  const imageOutput = providerError
    ? undefined
    : await prepareBashImageOutput(
        {
          artifactPath: stdoutPersistedOutputPath,
          artifactSize: stdoutPersistedOutputSize,
          inline: providerStdout,
        },
        context,
      );
  const stdout = imageOutput?.stdout ?? providerStdout;

  const ghRateLimitHint = providerError
    ? undefined
    : getGhRateLimitHint(input.command, result.stdout.text);
  return attachToolExecutionPerformance(
    {
      stdout,
      stderr,
      interrupted: result.timedOut || result.cancelled,
      isImage: imageOutput !== undefined,
      noOutputExpected: isSilentBashCommand(input.command),
      status: result.status,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      stdoutTruncated: result.stdout.truncated,
      stderrTruncated: result.stderr.truncated,
      stdoutBytes: result.stdout.bytes,
      stderrBytes: result.stderr.bytes,
      rawOutputPath: persistedOutputPath,
      dangerouslyDisableSandbox: input.dangerouslyDisableSandbox,
      returnCodeInterpretation,
      persistedOutputPath,
      stdoutPersistedOutputPath,
      stderrPersistedOutputPath,
      persistedOutputSize,
      stdoutPersistedOutputSize,
      stderrPersistedOutputSize,
      ...(ghRateLimitHint ? { ghRateLimitHint } : {}),
    },
    createBashPerformance(input, result, options.progressTiming),
  );
}

function createBashPerformance(
  input: BashInput,
  result: ExecutionResult,
  progressTiming: BashProgressTiming | undefined,
): ToolExecutionPerformance | undefined {
  const outputBytes = result.stdout.bytes + result.stderr.bytes;
  const firstOutputMs = progressTiming?.firstOutputMs;
  return compactToolExecutionPerformance({
    detail: {
      kind: "command",
      command: {
        runMs: roundNonNegativeMs(result.durationMs),
        firstOutputMs,
        noOutputMs: firstOutputMs ?? roundNonNegativeMs(result.durationMs),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputBytes,
        category: classifyCommand(input.command),
        ...classifySafeCommandIdentity(input.command),
        status: resolveBashCommandStatus(result),
      },
    },
  });
}

export function createBashBackgroundPerformance(
  input: BashInput,
): ToolExecutionPerformance | undefined {
  return compactToolExecutionPerformance({
    detail: {
      kind: "command",
      command: {
        category: classifyCommand(input.command),
        ...classifySafeCommandIdentity(input.command),
        status: "backgrounded",
      },
    },
  });
}

export function createEmptyBashPerformance(): ToolExecutionPerformance | undefined {
  return compactToolExecutionPerformance({
    detail: {
      kind: "command",
      command: {
        category: "empty",
        count: 0,
        name: "empty",
        status: "completed",
      },
    },
  });
}

function resolveBashCommandStatus(result: ExecutionResult): ToolCommandStatus {
  if (result.timedOut) return "timed_out";
  if (result.cancelled) return "cancelled";
  if (result.status === "completed" && result.exitCode !== undefined && result.exitCode !== 0) {
    return "failed";
  }
  return result.status;
}
