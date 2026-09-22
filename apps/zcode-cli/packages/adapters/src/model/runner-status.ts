import type {
  Logger,
  ModelNetworkStatusEvent,
  ModelReasoningCallHint,
  ModelStatusSink,
  ModelTransportKind,
  ModelRequestSessionType as ModelRequestSessionTypeValue,
  QueryId,
  ResolvedModelApiCallObservation,
  TraceId,
} from "@zcode/contracts";
import {
  ModelFailureReason as ModelFailureReasonValue,
  createTraceId,
  resolveModelApiCallObservation,
} from "@zcode/contracts";
import { UNBOUNDED_RETRY_MAX_ATTEMPTS } from "./retry-budget.js";
// 请求归因 header 一族住在 runner-attribution.ts（max-lines 拆分）；公开面仍从本文件导出，
// 既有 importer 不必改路径。
import { resolveModelRequestSessionType } from "./runner-attribution.js";
import type { AiSdkModelTextRequest, ResolvedAiSdkModel } from "./runner-runtime.js";
import { stringMetadata } from "./runner-record.js";

export {
  createModelRequestAttributionHeaders,
  normalizeModelSessionIdForAttribution,
  resolveModelRequestSessionType,
} from "./runner-attribution.js";

export interface ModelStatusContext {
  traceId: TraceId;
  queryId?: QueryId;
  sessionId?: ModelNetworkStatusEvent["sessionId"];
  turnId?: ModelNetworkStatusEvent["turnId"];
  parentSessionId?: ModelNetworkStatusEvent["parentSessionId"];
  toolCallId?: string;
  spanId?: string;
  parentSpanId?: string;
  querySource?: string;
  requestId: string;
  providerId: ResolvedAiSdkModel["providerId"];
  modelId: ResolvedAiSdkModel["modelId"];
  modelRequestSessionType: ModelRequestSessionTypeValue;
  baseURL?: string;
  providerKind?: string;
  transport: ModelTransportKind;
  maxAttempts: number;
  streamRecovery?: ModelNetworkStatusEvent["streamRecovery"];
  modelCall: ResolvedModelApiCallObservation;
}

export function createStatusContext(input: {
  maxAttempts: number;
  request: AiSdkModelTextRequest;
  resolved: ResolvedAiSdkModel;
  transport: ModelTransportKind;
}): ModelStatusContext {
  const metadata = input.request.metadata ?? {};
  const querySource = stringMetadata(metadata.querySource);
  const resolvedModelCall = resolveModelApiCallObservation(querySource, input.request.modelCall);
  return {
    baseURL: input.resolved.baseURL,
    maxAttempts: input.maxAttempts,
    providerId: input.resolved.providerId,
    modelId: input.resolved.modelId,
    modelRequestSessionType: resolveModelRequestSessionType(
      input.request.modelRequestSessionType,
      resolvedModelCall,
    ),
    requestId: stringMetadata(metadata.requestId) ?? crypto.randomUUID(),
    sessionId: (input.request.traceContext?.sessionId ??
      stringMetadata(metadata.sessionId)) as ModelStatusContext["sessionId"],
    spanId: input.request.traceContext?.spanId ?? stringMetadata(metadata.spanId),
    parentSpanId:
      input.request.traceContext?.parentSpanId ??
      stringMetadata(metadata.parentSpanId) ??
      stringMetadata(metadata.parentId),
    querySource,
    queryId: (input.request.traceContext?.queryId ?? stringMetadata(metadata.queryId)) as
      | QueryId
      | undefined,
    traceId: (input.request.traceContext?.traceId ??
      stringMetadata(metadata.traceId) ??
      createTraceId()) as TraceId,
    providerKind: input.resolved.providerKind,
    streamRecovery: input.request.streamRecovery,
    transport: input.transport,
    turnId: (input.request.traceContext?.turnId ??
      stringMetadata(metadata.turnId)) as ModelStatusContext["turnId"],
    parentSessionId: stringMetadata(metadata.parentSessionId) as
      | ModelStatusContext["parentSessionId"]
      | undefined,
    toolCallId: stringMetadata(metadata.toolCallId),
    modelCall: {
      ...resolvedModelCall,
      agentName: resolvedModelCall.agentName ?? stringMetadata(metadata.agentName),
      operationId:
        resolvedModelCall.operationId ??
        input.request.traceContext?.spanId ??
        stringMetadata(metadata.spanId),
      stepIndex:
        resolvedModelCall.stepIndex ??
        (typeof metadata.stepIndex === "number"
          ? metadata.stepIndex
          : typeof metadata.iteration === "number"
            ? metadata.iteration
            : undefined),
      reasoning: initialReasoningObservation(resolvedModelCall.reasoning, undefined),
    },
  };
}

export function createAttemptStatusContext(
  statusContext: ModelStatusContext,
  attempt: number,
): ModelStatusContext {
  if (attempt <= 1) {
    return statusContext;
  }

  return {
    ...statusContext,
    // adapter retry 会发起新的物理 provider 请求；
    // 复用首轮 requestId 会让上游日志和 retry-after 诊断串错请求。
    requestId: crypto.randomUUID(),
  };
}

function initialReasoningObservation(
  hint: ModelReasoningCallHint | undefined,
  modelVariant: string | undefined,
): ResolvedModelApiCallObservation["reasoning"] {
  const explicit = hint?.explicit;
  return {
    capability: "unknown",
    requestedControl: explicit?.controlType ?? "provider_default",
    requestedState: explicit?.state ?? "provider_default",
    requestedLevel: hint?.requestedLevel ?? modelVariant,
    effectiveControl: explicit?.controlType ?? "unknown",
    effectiveState: explicit?.state ?? "unknown",
    effectiveLevel:
      explicit?.effectiveLevel ?? (explicit?.state === "disabled" ? "disabled" : "unknown"),
    ...(explicit?.effectiveBudgetTokens !== undefined
      ? { effectiveBudgetTokens: explicit.effectiveBudgetTokens }
      : {}),
  };
}

/**
 * 准入等待两端的状态事件：`admitAttempt` 的 `tryAcquire` 未命中即 `queued`，拿到票即
 * `admitted`（带排队时长）。此时还没有票据，所以不经 ticket 投递——治理器不需要这两条。
 */
export function admissionWaitPublishers(
  statusContext: ModelStatusContext,
  attempt: number,
  publishOptions: Parameters<typeof publishModelStatus>[1],
): {
  onQueued: () => Promise<void>;
  onAdmitted: (queuedMs: number) => Promise<void>;
} {
  return {
    onQueued: () =>
      publishModelStatus(
        {
          ...statusContext,
          attempt,
          timestamp: new Date().toISOString(),
          type: "model_request_queued",
        },
        publishOptions,
      ),
    onAdmitted: (queuedMs) =>
      publishModelStatus(
        {
          ...statusContext,
          attempt,
          queuedMs,
          timestamp: new Date().toISOString(),
          type: "model_request_admitted",
        },
        publishOptions,
      ),
  };
}

export async function publishModelStatus(
  event: ModelNetworkStatusEvent,
  options: {
    /**
     * 本次尝试的准入票据：它是该尝试专属的
     * 状态事件汇，治理器从这里读结果。与 request sink 同一条投递纪律（失败只告警）。
     */
    admissionTicket?: ModelStatusSink;
    logger?: Logger;
    requestStatusSink?: ModelStatusSink;
    statusSink?: ModelStatusSink;
  },
): Promise<void> {
  logStatusEvent(event, options.logger);

  const deliveries: Array<() => void | Promise<void>> = [];
  if (options.admissionTicket) {
    const ticket = options.admissionTicket;
    deliveries.push(() => ticket.publish(event));
  }
  if (options.statusSink) {
    const statusSink = options.statusSink;
    if (options.requestStatusSink && options.requestStatusSink !== options.statusSink) {
      deliveries.push(() => options.requestStatusSink!.publish(event));
    }
    deliveries.push(() => statusSink.publish(event));
  } else if (options.requestStatusSink) {
    deliveries.push(() => options.requestStatusSink!.publish(event));
  }
  if (deliveries.length === 0) return;

  const results = await Promise.allSettled(
    deliveries.map((deliver) => Promise.resolve().then(deliver)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      options.logger?.warn("Model status sink failed", {
        ...modelStatusLogContext(event),
        event: "model.status_sink.failed",
        status: "failed",
      });
    }
  }
}

export function modelStatusContextToLogContext(
  statusContext: ModelStatusContext | ModelNetworkStatusEvent,
  attempt: number,
): Record<string, unknown> {
  return {
    attempt,
    maxAttempts: statusContext.maxAttempts,
    // maxAttempts 为 0 表示无上限：maxRetries 同样以 0 表达，而不是 max(0, -1) 巧合得到的 0。
    maxRetries:
      statusContext.maxAttempts === UNBOUNDED_RETRY_MAX_ATTEMPTS
        ? UNBOUNDED_RETRY_MAX_ATTEMPTS
        : Math.max(0, statusContext.maxAttempts - 1),
    querySource: statusContext.querySource,
    transport: statusContext.transport,
  };
}

function modelStatusLogContext(event: ModelNetworkStatusEvent): Record<string, unknown> {
  return modelStatusContextToLogContext(event, event.attempt);
}

function logStatusEvent(event: ModelNetworkStatusEvent, logger?: Logger): void {
  switch (event.type) {
    case "model_request_queued":
      logger?.debug("Model request queued for admission", {
        ...modelStatusLogContext(event),
        event: "model.request.queued",
        status: "waiting",
      });
      return;

    case "model_request_admitted":
      logger?.debug("Model request admitted", {
        ...modelStatusLogContext(event),
        event: "model.request.admitted",
        queuedMs: event.queuedMs,
        status: "started",
      });
      return;

    case "model_request_started":
      logger?.debug("Model request attempt started", {
        ...modelStatusLogContext(event),
        event: "model.request.started",
        status: "started",
      });
      return;

    case "model_request_completed":
      logger?.info("Model request completed", {
        ...modelStatusLogContext(event),
        durationMs: event.durationMs,
        event: "model.request.completed",
        finishReason: event.finishReason,
        status: "completed",
      });
      return;

    case "model_retry_scheduled":
      logger?.warn("Model request retry scheduled", {
        ...modelStatusLogContext(event),
        delayMs: event.delayMs,
        event: "model.retry.scheduled",
        nextAttempt: event.nextAttempt,
        reason: event.reason,
        status: "waiting",
        statusCode: event.statusCode,
      });
      return;

    case "model_request_failed":
      logger?.warn("Model request attempt failed", {
        ...modelStatusLogContext(event),
        durationMs: event.durationMs,
        event: "model.request.failed",
        reason: event.reason,
        retryable: event.retryable,
        status: event.reason === ModelFailureReasonValue.Cancelled ? "cancelled" : "failed",
        statusCode: event.statusCode,
      });
      return;

    case "model_stream_stalled":
      logger?.warn("Model stream stalled", {
        ...modelStatusLogContext(event),
        event: "model.stream.stalled",
        idleMs: event.idleMs,
        status: "waiting",
        timeoutMs: event.timeoutMs,
      });
      return;
  }
}

/** 本地流式时序；不投递业务状态 sink，也不复制请求身份或内容。 */
export function logModelMilestone(
  logger: Logger | undefined,
  event: "model_first_provider_event" | "model_first_content" | "model_first_text",
  attempt: number,
  elapsedMs: number,
): void {
  logger?.debug("Model stream milestone observed", {
    event,
    attempt,
    elapsedMs,
    stage:
      event === "model_first_provider_event"
        ? "provider_event"
        : event === "model_first_content"
          ? "content"
          : "text",
    status: "completed",
  });
}
