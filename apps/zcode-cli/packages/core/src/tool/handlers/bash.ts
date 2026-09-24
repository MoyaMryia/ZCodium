// ============================================================
// Bash Tool Handler
// ============================================================

import {
  BashInputJsonSchema,
  BashInputSchema,
  BashOutputJsonSchema,
  BashOutputSchema,
  CoreErrorType,
  SessionEventType,
  createCoreError,
  type BackgroundExecutionStartResult,
  type BashInput,
  type BashOutput,
  type ExecutionEvent,
  type ExecutionRequest,
  type ExecutionRunOptions,
  type TraceContext,
} from "@zcode/contracts";
import {
  shouldInjectEmbeddedSearchBashPrelude,
  supportsEmbeddedSearchShellSelection,
} from "../../embedded-search/shell.js";
import {
  DEFAULT_BASH_TIMEOUT_POLICY,
  resolveBashTimeoutMs,
  type BashTimeoutPolicy,
} from "../bash-timeout-policy.js";
import { resolveToolWorkingDirectory } from "../path-policy.js";
import type {
  ToolEntry,
  ToolExecutionContext,
  ToolHandler,
  ToolRuntimePermissionCapability,
  ToolRuntimePermissionCapabilityContext,
} from "../types.js";
import { supportsBashBackgroundLifecycle } from "./bash-background-lifecycle.js";
import { isBashAutoBackgroundEligible } from "./bash-background-policy.js";
import { resolveBashPermissionRulePolicy } from "./bash-command-permission-policy.js";
import { decideBashCwdPolicy } from "./bash-cwd-policy.js";
import { readStringProperty } from "./bash-metadata.js";
import { formatBashModelContent, formatPersistedBashModelContent } from "./bash-model-content.js";
import {
  createBashBackgroundPerformance,
  createEmptyBashPerformance,
  toBashOutput,
  type BashProgressTiming,
} from "./bash-output.js";
import { createBashProviderDescription } from "./bash-prompt.js";
import { applyBashReadFileStateEffects } from "./bash-read-file-state.js";
import { isRuntimeReadOnlyBashCommand } from "./bash-semantics.js";
import { attachToolExecutionPerformance } from "./tool-perf.js";
export {
  getBashActivityDescription,
  getBashAutoClassifierInput,
  getBashDescription,
  getBashToolUseSummary,
  getBashUserFacingName,
} from "./bash-metadata.js";

const MAX_INLINE_OUTPUT_BYTES = 30_000;
const MAX_RUNTIME_PERSISTED_OUTPUT_BYTES = 5 * 1024 * 1024 * 1024;
const BASH_PROVIDER_DESCRIPTION = createBashProviderDescription({
  defaultTimeoutMs: DEFAULT_BASH_TIMEOUT_POLICY.defaultTimeoutMs,
  maxTimeoutMs: DEFAULT_BASH_TIMEOUT_POLICY.maxTimeoutMs,
});

function resolveBashPermissionCapability(
  input: unknown,
  context?: ToolRuntimePermissionCapabilityContext,
): ToolRuntimePermissionCapability | undefined {
  const command = readStringProperty(input, "command");
  if (!command || !isRuntimeReadOnlyBashCommand(command, context)) return undefined;
  return {
    destructive: false,
    needsApproval: false,
    readOnly: true,
    riskLevel: "low" as const,
    sideEffectScope: "none" as const,
    permission: {
      needsApproval: false,
      riskLevel: "low" as const,
      sideEffectScope: "none" as const,
    },
  };
}

const bashHandler: ToolHandler = (input, context) =>
  executeBashHandler(input, context, DEFAULT_BASH_TIMEOUT_POLICY);

function createBashHandler(timeoutPolicy: BashTimeoutPolicy): ToolHandler {
  return (input, context) => executeBashHandler(input, context, timeoutPolicy);
}

async function executeBashHandler(
  input: unknown,
  context: ToolExecutionContext,
  timeoutPolicy: BashTimeoutPolicy,
): Promise<BashOutput> {
  const parsed = BashInputSchema.parse(input) as BashInput;
  const executionPort = context.executionPort;

  if (!executionPort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "ExecutionPort is not configured for Bash tool",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Bash",
        },
        recoverable: false,
      },
    );
  }

  if (parsed.command.trim().length === 0) {
    return emptyBashOutput(parsed);
  }

  const request = createExecutionRequest(parsed, context, timeoutPolicy);
  const progressTiming: BashProgressTiming = {};
  const runOptions = createExecutionRunOptions(context, progressTiming);
  const eligibleForAutoBackground = isBashAutoBackgroundEligible(parsed);
  const backgroundLifecyclePort = supportsBashBackgroundLifecycle(executionPort)
    ? executionPort
    : undefined;

  if (parsed.run_in_background && !backgroundLifecyclePort) {
    throw createCoreError(
      CoreErrorType.ConfigurationError,
      "ExecutionPort does not support the Bash background lifecycle",
      {
        context: {
          toolCallId: context.toolCallId,
          toolName: "Bash",
        },
        recoverable: false,
      },
    );
  }

  const runCommand = async () =>
    parsed.run_in_background && backgroundLifecyclePort
      ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
          request,
          { mode: "explicit" },
          runOptions,
        )
      : eligibleForAutoBackground && backgroundLifecyclePort
        ? backgroundLifecyclePort.runBashWithBackgroundLifecycle(
            request,
            { mode: "auto_on_timeout" },
            runOptions,
          )
        : {
            kind: "foreground" as const,
            result: await executionPort.run(request, runOptions),
          };
  const runResult = await runCommand();

  if (runResult.kind === "backgrounded") {
    return toBackgroundedBashOutput(runResult.task, parsed);
  }

  const result = runResult.result;
  const cwdDecision = decideBashCwdPolicy({
    status: result.status,
    exitCode: result.exitCode,
    resolvedCwd: result.resolvedCwd,
    workspaceRoot: context.workspaceRoot,
    runtimeScope: context.runtimeScope,
  });
  if (cwdDecision.nextWorkingDirectory) {
    // 主线程 Bash 成功后会保留项目内 cwd；
    // 离开项目边界时 reset 回原始工作区，并把 reset 文案放进 Bash stderr。
    await context.setWorkingDirectory?.(cwdDecision.nextWorkingDirectory);
  }
  const output = await toBashOutput(result, parsed, context, {
    progressTiming,
    stderrSuffix: cwdDecision.stderrSuffix,
  });
  await applyBashReadFileStateEffects({
    command: parsed.command,
    context,
    output,
    result,
  });
  return output;
}

function emptyBashOutput(input: BashInput): BashOutput {
  return attachToolExecutionPerformance(
    {
      stdout: "",
      stderr: "",
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      status: "completed",
      dangerouslyDisableSandbox: input.dangerouslyDisableSandbox,
    },
    createEmptyBashPerformance(),
  );
}

function toBackgroundedBashOutput(
  task: BackgroundExecutionStartResult,
  input: BashInput,
): BashOutput {
  return attachToolExecutionPerformance(
    {
      stdout: "",
      stderr: "",
      interrupted: false,
      status: "backgrounded",
      backgroundTaskId: task.taskId,
      rawOutputPath: task.outputPath,
      persistedOutputPath: task.outputPath,
      stdoutPersistedOutputPath: task.stdoutPersistedOutputPath,
      stderrPersistedOutputPath: task.stderrPersistedOutputPath,
      dangerouslyDisableSandbox: input.dangerouslyDisableSandbox,
    },
    createBashBackgroundPerformance(input),
  );
}

function createExecutionRunOptions(
  context: ToolExecutionContext,
  progressTiming?: BashProgressTiming,
): ExecutionRunOptions {
  return {
    signal: context.abortSignal,
    onEvent: async (event) => {
      if (event.type !== "progress") return;
      if (
        progressTiming &&
        progressTiming.firstOutputMs === undefined &&
        event.stdoutBytes + event.stderrBytes > 0
      ) {
        progressTiming.firstOutputMs = Math.max(0, Math.round(event.elapsedMs));
      }
      await emitProgressEvent(event, context);
    },
  };
}

async function emitProgressEvent(
  event: Extract<ExecutionEvent, { type: "progress" }>,
  context: ToolExecutionContext,
): Promise<void> {
  if (!context.emitEvent) return;

  await context.emitEvent({
    id: crypto.randomUUID() as any,
    sessionId: context.sessionId,
    turnId: context.turnId,
    type: SessionEventType.ToolCallProgress,
    timestamp: event.timestamp,
    traceId: context.traceId,
    sequenceNumber: 0,
    payload: {
      toolCallId: context.toolCallId,
      toolName: "Bash",
      elapsedMs: event.elapsedMs,
      pid: event.pid,
      stdoutBytes: event.stdoutBytes,
      stderrBytes: event.stderrBytes,
      outputBytes: event.stdoutBytes + event.stderrBytes,
      outputPreview: event.outputPreview,
      stdoutTail: event.stdoutTail,
      stderrTail: event.stderrTail,
    },
  });
}

function createExecutionRequest(
  input: BashInput,
  context: ToolExecutionContext,
  timeoutPolicy: BashTimeoutPolicy,
): ExecutionRequest {
  const shellSelection = context.bashShellSelection;
  const bashPrelude =
    shouldInjectEmbeddedSearchBashPrelude() &&
    context.embeddedSearch?.enabled === true &&
    context.embeddedSearch.backend &&
    supportsEmbeddedSearchShellSelection(shellSelection)
      ? {
          kind: "embedded-search" as const,
          backend: context.embeddedSearch.backend,
          ...(context.embeddedSearch.findAndGrepEnabled === false
            ? { findAndGrepEnabled: false }
            : {}),
        }
      : undefined;
  return {
    command: {
      mode: "shell",
      command: input.command,
      shellProfile: "posix-bash",
      ...(shellSelection ? { shellOverride: shellSelection } : {}),
    },
    cwd: resolveToolWorkingDirectory(undefined, {
      operation: "execute",
      workingDirectory: context.workingDirectory,
      workspaceRoot: context.workspaceRoot,
    }),
    ...(bashPrelude ? { bashPrelude } : {}),
    captureCwdAfterSuccess: input.run_in_background ? undefined : true,
    timeoutMs: resolveBashTimeoutMs(input.timeout, timeoutPolicy),
    outputLimit: {
      maxInlineBytes: MAX_INLINE_OUTPUT_BYTES,
      maxBufferBytes: MAX_INLINE_OUTPUT_BYTES,
      maxPersistedBytes: MAX_RUNTIME_PERSISTED_OUTPUT_BYTES,
      persistOutput: input.run_in_background ? "always" : "on_truncate",
    },
    sandbox: {
      enabled: !input.dangerouslyDisableSandbox,
      dangerouslyDisableSandbox: input.dangerouslyDisableSandbox,
    },
    trace: {
      traceId: context.traceId,
      spanId: context.spanId,
      parentSpanId: context.parentSpanId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      attributes: {
        toolCallId: context.toolCallId,
        toolName: "Bash",
      },
    } as unknown as TraceContext,
  };
}

export const bashToolEntry: ToolEntry = {
  capability: "Execute platform shell commands through the execution adapter",
  metadata: {
    name: "Bash",
    description: BASH_PROVIDER_DESCRIPTION,
    readOnly: false,
    destructive: false,
    concurrentSafe: false,
    timeoutMs: DEFAULT_BASH_TIMEOUT_POLICY.defaultTimeoutMs,
    maxOutputBytes: 10_000_000,
    sideEffectScope: "system",
    riskLevel: "high",
    needsApproval: true,
  },
  formatModelContent: formatBashModelContent,
  formatPersistedModelContent: formatPersistedBashModelContent,
  handler: bashHandler,
  resolveTimeoutBudgetMs: createBashTimeoutBudgetResolver(DEFAULT_BASH_TIMEOUT_POLICY),
  resolvePermissionCapability: resolveBashPermissionCapability,
  resolvePermissionRulePolicy: resolveBashPermissionRulePolicy,
  inputSchema: BashInputJsonSchema,
  outputSchema: BashOutputJsonSchema,
  runtimeInputSchema: BashInputSchema,
  runtimeOutputSchema: BashOutputSchema,
  permission: {
    permission: "bash",
    reason: "Bash can run subprocesses and may affect workspace, git, network, or system state",
    riskLevel: "high",
    sideEffectScope: "system",
    needsApproval: true,
    patternSources: ["command"],
    alwaysAllowPatternSources: ["command"],
    denyPriority: "beforeAsk",
  },
  resultBudget: {
    maxInlineBytes: MAX_INLINE_OUTPUT_BYTES,
    maxModelBytes: 30_000,
    strategy: "artifact",
    preview: {
      maxBytes: 30_000,
      direction: "tail",
    },
    artifact: {
      enabled: true,
      retention: "session",
    },
  },
  timeout: {
    defaultMs: DEFAULT_BASH_TIMEOUT_POLICY.defaultTimeoutMs,
    maxMs: DEFAULT_BASH_TIMEOUT_POLICY.maxTimeoutMs,
    allowCallOverride: true,
    cleanupGraceMs: 6_000,
  },
  cancellation: {
    supported: true,
    cleanup: "bestEffort",
    userVisibleMessage: "Bash was cancelled and the child process was asked to stop",
  },
  trace: {
    required: true,
    propagateToAdapters: true,
    recordInput: "summary",
    recordOutput: "summary",
  },
};

export function createBashToolEntry(
  options: {
    bashTimeoutPolicy?: BashTimeoutPolicy;
    embeddedSearchEnabled?: boolean;
  } = {},
): ToolEntry {
  const timeoutPolicy = options.bashTimeoutPolicy ?? DEFAULT_BASH_TIMEOUT_POLICY;
  return {
    ...bashToolEntry,
    handler: createBashHandler(timeoutPolicy),
    inputSchema: createBashInputJsonSchema(timeoutPolicy),
    resolveTimeoutBudgetMs: createBashTimeoutBudgetResolver(timeoutPolicy),
    metadata: {
      ...bashToolEntry.metadata,
      description: createBashProviderDescription({
        defaultTimeoutMs: timeoutPolicy.defaultTimeoutMs,
        embeddedSearchEnabled: options.embeddedSearchEnabled,
        maxTimeoutMs: timeoutPolicy.maxTimeoutMs,
      }),
      timeoutMs: timeoutPolicy.defaultTimeoutMs,
    },
    timeout: {
      defaultMs: timeoutPolicy.defaultTimeoutMs,
      maxMs: timeoutPolicy.maxTimeoutMs,
      allowCallOverride: true,
      cleanupGraceMs: 6_000,
    },
  };
}

function createBashTimeoutBudgetResolver(
  timeoutPolicy: BashTimeoutPolicy,
): NonNullable<ToolEntry["resolveTimeoutBudgetMs"]> {
  return (input) => {
    const parsed = BashInputSchema.safeParse(input);
    // 旧 watchdog 直接读取 raw timeout，导致 0 被压成 1ms，且字符串数字绕过
    // Bash policy。这里和 handler 共用 timeout || default / max 解析后再加 cleanup grace。
    return resolveBashTimeoutMs(parsed.success ? parsed.data.timeout : undefined, timeoutPolicy);
  };
}

function createBashInputJsonSchema(timeoutPolicy: BashTimeoutPolicy): Record<string, unknown> {
  const schema = BashInputJsonSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown> | undefined;
  const timeoutProperty = properties?.timeout as Record<string, unknown> | undefined;
  if (!properties || !timeoutProperty) return schema;

  return {
    ...schema,
    properties: {
      ...properties,
      timeout: {
        ...timeoutProperty,
        description: `Optional timeout in milliseconds (max ${timeoutPolicy.maxTimeoutMs})`,
      },
    },
  };
}
