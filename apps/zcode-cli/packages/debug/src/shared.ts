export type ObservationSourceKind = "log" | "eventlog" | "sqlite";

export interface SourceStatus {
  kind: ObservationSourceKind;
  label: string;
  path?: string;
  available: boolean;
  recordCount: number;
  warning?: string;
}

export interface TraceSummary {
  traceId: string;
  sessionIds: string[];
  eventCount: number;
  logCount: number;
  firstAt?: string;
  lastAt?: string;
  firstUserMessage?: string;
  lastMessage?: string;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ProjectSummary {
  projectId: string;
  label: string;
  directory: string;
  sessionCount: number;
  updatedAt?: string;
}

export interface TimelineItem {
  id: string;
  at?: string;
  source: ObservationSourceKind;
  kind: string;
  label: string;
  severity?: "debug" | "info" | "warn" | "error";
  traceId?: string;
  sessionId?: string;
  turnId?: string;
  spanId?: string;
  parentSpanId?: string;
  toolCallId?: string;
  summary: string;
  payload?: unknown;
}

export type TraceSpanLane =
  | "turn"
  | "model"
  | "tool"
  | "network"
  | "permission"
  | "storage"
  | "subagent"
  | "event"
  | "log";

export type TraceSpanStatus = "running" | "ok" | "error" | "cancelled" | "unknown";

export interface TraceSpan {
  id: string;
  traceId?: string;
  sessionId?: string;
  turnId?: string;
  spanId?: string;
  parentSpanId?: string;
  toolCallId?: string;
  lane: TraceSpanLane;
  label: string;
  source: ObservationSourceKind;
  startAt: string;
  endAt?: string;
  status: TraceSpanStatus;
  summary?: string;
  payload?: unknown;
}

export type ContextSectionSource = "system_prompt" | "skills" | "tools" | "other";
export type TokenMethod =
  | "estimated"
  | "provider_count"
  | "proportional_estimate"
  | "provider_usage";
export type TokenConfidence = "high" | "medium" | "low";

export interface TokenMeasurement {
  tokens: number;
  tokenMethod?: TokenMethod;
  confidence?: TokenConfidence;
  tokenizer?: string;
}

export interface ContextSectionView {
  id: string;
  name: string;
  source: ContextSectionSource;
  chars: number;
  tokens: number;
  percentTokens: number;
  preview?: string;
  content?: string;
  observable: "full" | "metadata" | "inferred";
}

export interface ContextSnapshotView {
  id: string;
  at?: string;
  traceId?: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
  totalChars: number;
  totalTokens: number;
  messageCount: number;
  sections: ContextSectionView[];
  systemPrompt?: string;
  observationLevel: "full" | "metadata" | "inferred";
  warnings: string[];
}

export type ContextUsageSource =
  | "system_prompt"
  | "meta_user_context"
  | "skills"
  | "tool_prompt"
  | "system_tool_schemas"
  | "mcp_tool_schemas"
  | "messages"
  | "other";

export interface ContextUsageCategory extends TokenMeasurement {
  id: string;
  name: string;
  source: ContextUsageSource;
  chars: number;
  percentTokens: number;
}

export interface ContextUsageToolDetail extends TokenMeasurement {
  name: string;
  source: "system_tool" | "mcp_tool";
  chars?: number;
  readOnly?: boolean;
  serverName?: string;
  sideEffectScope?: string;
}

export interface ContextUsageSkillDetail extends TokenMeasurement {
  name: string;
  source?: string;
  scope?: string;
  path?: string;
  chars?: number;
}

export interface ContextUsageMessageBreakdown extends TokenMeasurement {
  role: string;
  count: number;
  chars: number;
}

export interface ContextUsageSnapshotView {
  id: string;
  at?: string;
  traceId?: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
  totalChars: number;
  totalTokens: number;
  tokenMethod?: TokenMethod;
  confidence?: TokenConfidence;
  tokenizer?: string;
  categories: ContextUsageCategory[];
  systemTools: ContextUsageToolDetail[];
  mcpTools: ContextUsageToolDetail[];
  skills: ContextUsageSkillDetail[];
  messageBreakdown: ContextUsageMessageBreakdown[];
  warnings: string[];
}

export type CacheSegmentStatus = "hit" | "miss" | "unknown";

export interface CacheSegment {
  id: string;
  status: CacheSegmentStatus;
  role?: string;
  source?: ContextSectionSource | "message";
  tokens?: number;
  chars?: number;
  preview: string;
  contentHash?: string;
  reason?: string;
}

export interface CacheReport {
  id: string;
  at?: string;
  traceId?: string;
  sessionId?: string;
  turnId?: string;
  model?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  hitRate: number | null;
  segments: CacheSegment[];
  limitations: string[];
}

export interface DeveloperRequest {
  title: string;
  reason: string;
  eventName: string;
  schema: string[];
}

export interface ObservationSourceFingerprint {
  kind: ObservationSourceKind;
  label: string;
  path: string;
  exists: boolean;
  signature: string;
}

export interface ObservationHelloEvent {
  generatedAt: string;
  intervalMs: number;
  sources: ObservationSourceFingerprint[];
}

export interface ObservationChangeEvent {
  revision: number;
  changedAt: string;
  changedSources: ObservationSourceFingerprint[];
  sources: ObservationSourceFingerprint[];
}

export interface ObservationSourceErrorEvent {
  checkedAt: string;
  message: string;
}

export interface TraceListResponse {
  sources: SourceStatus[];
  projects: ProjectSummary[];
  traces: TraceSummary[];
}

export interface TraceDetailResponse {
  traceId: string;
  sessions: string[];
  sources: SourceStatus[];
  timeline: TimelineItem[];
  spans: TraceSpan[];
  contextSnapshots: ContextSnapshotView[];
  contextUsageSnapshots: ContextUsageSnapshotView[];
  cacheReports: CacheReport[];
  developerRequests: DeveloperRequest[];
}
