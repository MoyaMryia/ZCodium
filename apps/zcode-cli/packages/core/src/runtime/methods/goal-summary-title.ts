import { traceContextToLogContext } from "../deps.js";
import type { TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import {
  GOAL_SUMMARY_TITLE_QUERY_SOURCE,
  generateTitleCandidate,
  normalizeTitleInput,
} from "./title-generation-sidecar.js";

const FALLBACK_GOAL_SUMMARY_TITLE_MAX_CHARS = 100;

export function maybeStartGoalSummaryTitleGeneration(
  this: AgentRuntimeInternal,
  input: string,
  targetID: string,
  options?: { traceContext?: TraceContext },
): boolean {
  const traceContext = options?.traceContext ?? this.rootTraceContext;
  if (!shouldAttemptGoalSummaryTitleGeneration(this, input, targetID)) {
    this.logger?.debug("Goal summary title generation skipped", {
      ...traceContextToLogContext(traceContext),
      event: "goal_summary_title_generation.skipped",
      module: "core.runtime",
      reason: "not_eligible",
      targetId: targetID,
    });
    void this.trackResidencyBlockingWork(
      persistFallbackGoalSummaryTitle.call(this, {
        objective: input,
        reason: "generation_not_eligible",
        targetID,
        traceContext,
      }),
    ).catch((error) => {
      logGoalSummaryFallbackFailure(this, error, targetID, traceContext);
    });
    return false;
  }
  const generation = generateAndPersistGoalSummaryTitle
    .call(this, input, targetID, traceContext)
    .catch(async (error) => {
      this.logger?.warn("Goal summary title generation failed", {
        ...traceContextToLogContext(traceContext),
        errorMessage: error instanceof Error ? error.message : String(error),
        event: "goal_summary_title_generation.failed",
        module: "core.runtime",
        status: "failed",
        targetId: targetID,
      });
      await persistFallbackGoalSummaryTitle.call(this, {
        objective: input,
        reason: "model_error",
        targetID,
        traceContext,
      });
    });
  void this.trackResidencyBlockingWork(generation).catch((error) => {
    logGoalSummaryFallbackFailure(this, error, targetID, traceContext);
  });
  return true;
}

function logGoalSummaryFallbackFailure(
  runtime: AgentRuntimeInternal,
  error: unknown,
  targetID: string,
  traceContext: TraceContext,
): void {
  runtime.logger?.warn("Goal summary title fallback persistence failed", {
    ...traceContextToLogContext(traceContext),
    errorMessage: error instanceof Error ? error.message : String(error),
    event: "goal_summary_title_generation.fallback_failed",
    module: "core.runtime",
    status: "failed",
    targetId: targetID,
  });
}

export async function persistGeneratedGoalSummaryTitle(
  this: AgentRuntimeInternal,
  input: {
    targetID: string;
    title: string;
    traceContext: TraceContext;
  },
): Promise<void> {
  const previousTarget = await this.sessionStore?.readTarget({ sessionID: this.sessionId });
  if (!previousTarget || previousTarget.targetID !== input.targetID) {
    this.logger?.debug("Goal summary title generation skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.skipped",
      module: "core.runtime",
      reason: "stale_target_before_write",
      targetId: input.targetID,
    });
    return;
  }
  if (previousTarget.summaryTitle === input.title) {
    this.logger?.debug("Goal summary title generation skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.skipped",
      module: "core.runtime",
      reason: "unchanged_title",
      targetId: input.targetID,
      titleLength: input.title.length,
    });
    return;
  }

  const updatedTarget = await this.sessionStore?.updateTargetSummaryTitle({
    sessionID: this.sessionId,
    summaryTitle: input.title,
    targetID: input.targetID,
  });
  if (
    !updatedTarget ||
    updatedTarget.targetID !== input.targetID ||
    updatedTarget.summaryTitle !== input.title
  ) {
    this.logger?.debug("Goal summary title generation skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.skipped",
      module: "core.runtime",
      reason: "target_changed_during_write",
      targetId: input.targetID,
    });
    return;
  }

  this.logger?.info("Goal summary title generation completed", {
    ...traceContextToLogContext(input.traceContext),
    event: "goal_summary_title_generation.completed",
    module: "core.runtime",
    status: "completed",
    targetId: input.targetID,
    titleLength: input.title.length,
  });

  await this.recordTargetChanged({
    action: "summary_updated",
    previousTarget,
    source: "runtime",
    target: updatedTarget,
    traceContext: input.traceContext,
  });
}

export async function persistFallbackGoalSummaryTitle(
  this: AgentRuntimeInternal,
  input: {
    objective: string;
    reason: string;
    targetID: string;
    traceContext: TraceContext;
  },
): Promise<void> {
  const title = fallbackGoalSummaryTitle(input.objective);
  if (!title) return;

  const previousTarget = await this.sessionStore?.readTarget({ sessionID: this.sessionId });
  if (!previousTarget || previousTarget.targetID !== input.targetID) {
    this.logger?.debug("Goal summary title fallback skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.fallback_skipped",
      module: "core.runtime",
      reason: "stale_target_before_write",
      targetId: input.targetID,
    });
    return;
  }
  if (previousTarget.summaryTitle?.trim()) {
    this.logger?.debug("Goal summary title fallback skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.fallback_skipped",
      module: "core.runtime",
      reason: "existing_title",
      targetId: input.targetID,
    });
    return;
  }

  const updatedTarget = await this.sessionStore?.updateTargetSummaryTitle({
    sessionID: this.sessionId,
    summaryTitle: title,
    targetID: input.targetID,
  });
  if (
    !updatedTarget ||
    updatedTarget.targetID !== input.targetID ||
    updatedTarget.summaryTitle !== title
  ) {
    this.logger?.debug("Goal summary title fallback skipped", {
      ...traceContextToLogContext(input.traceContext),
      event: "goal_summary_title_generation.fallback_skipped",
      module: "core.runtime",
      reason: "target_changed_during_write",
      targetId: input.targetID,
    });
    return;
  }

  this.logger?.info("Goal summary title fallback persisted", {
    ...traceContextToLogContext(input.traceContext),
    event: "goal_summary_title_generation.fallback_persisted",
    module: "core.runtime",
    reason: input.reason,
    status: "completed",
    targetId: input.targetID,
    titleLength: title.length,
  });

  await this.recordTargetChanged({
    action: "summary_updated",
    previousTarget,
    source: "runtime",
    target: updatedTarget,
    traceContext: input.traceContext,
  });
}

function shouldAttemptGoalSummaryTitleGeneration(
  runtime: AgentRuntimeInternal,
  input: string,
  targetID: string,
): boolean {
  if (runtime.config.titleGeneration?.enabled === false) return false;
  if (!runtime.config.titleGeneration) return false;
  if (!runtime.sessionStore) return false;
  if (runtime.config.parentSessionId) return false;
  if (runtime.config.taskType && runtime.config.taskType !== "interactive") return false;
  if (targetID.trim().length === 0) return false;
  return normalizeTitleInput(input).length > 0;
}

async function generateAndPersistGoalSummaryTitle(
  this: AgentRuntimeInternal,
  input: string,
  targetID: string,
  traceContext: TraceContext,
): Promise<void> {
  const currentTarget = await this.sessionStore?.readTarget({ sessionID: this.sessionId });
  if (!currentTarget || currentTarget.targetID !== targetID) {
    this.logger?.debug("Goal summary title generation skipped", {
      ...traceContextToLogContext(traceContext),
      event: "goal_summary_title_generation.skipped",
      module: "core.runtime",
      reason: "stale_target_before_request",
      targetId: targetID,
    });
    return;
  }

  this.logger?.info("Goal summary title generation started", {
    ...traceContextToLogContext(traceContext),
    event: "goal_summary_title_generation.started",
    module: "core.runtime",
    status: "started",
    targetId: targetID,
  });

  const generated = await generateTitleCandidate.call(this, input, {
    querySource: GOAL_SUMMARY_TITLE_QUERY_SOURCE,
    traceContext,
  });
  if (!generated) {
    // 第一轮迭代标题只读 target.summaryTitle；标题模型空响应时也要写入目标语义兜底，
    // 否则 UI 只能退回“第 1 次迭代”，看起来像 summaryTitle 丢失。
    await persistFallbackGoalSummaryTitle.call(this, {
      objective: input,
      reason: "empty_model_title",
      targetID,
      traceContext,
    });
    return;
  }

  await persistGeneratedGoalSummaryTitle.call(this, {
    targetID,
    title: generated.title,
    traceContext: generated.traceContext,
  });
}

function fallbackGoalSummaryTitle(objective: string): string | null {
  const normalized = normalizeTitleInput(objective);
  if (!normalized) return null;
  if (normalized.length <= FALLBACK_GOAL_SUMMARY_TITLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, FALLBACK_GOAL_SUMMARY_TITLE_MAX_CHARS - 3).trim()}...`;
}
