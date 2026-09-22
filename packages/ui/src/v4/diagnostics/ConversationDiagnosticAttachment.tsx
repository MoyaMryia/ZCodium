import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { ConversationTelemetryFact } from "@zcode/shared/zcode-protocol-v4";
import { createConversationTelemetryService, type IServiceAccessor } from "@zcode/services";
import { ConversationDiagnostics } from "@/v4/diagnostics/conversationDiagnostics.js";

interface ConversationDiagnosticAttachmentScope {
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

interface ConversationDiagnosticAttachmentValue {
  scope: ConversationDiagnosticAttachmentScope;
  supervisor: ConversationDiagnostics;
  foregroundEnabled: boolean;
}

interface SupervisorRegistryEntry {
  key: string;
  logicalScopeKey: string;
  supervisor: ConversationDiagnostics;
  refCount: number;
  subscription: { dispose(): void } | null;
  stale: boolean;
  workspaceDetached: boolean;
}

interface SupervisorLease {
  entry: SupervisorRegistryEntry;
  release(): void;
}

const serviceGenerationIds = new WeakMap<object, number>();
let nextServiceGenerationId = 1;
const supervisorRegistry = new Map<string, SupervisorRegistryEntry>();

function serviceGenerationId(service: object): number {
  const existing = serviceGenerationIds.get(service);
  if (existing !== undefined) return existing;
  const created = nextServiceGenerationId;
  nextServiceGenerationId += 1;
  serviceGenerationIds.set(service, created);
  return created;
}

function attachmentScopeKey(scope: ConversationDiagnosticAttachmentScope, service: object): string {
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  return [scope.remoteSessionId ?? "__base__", workspaceKey, serviceGenerationId(service)].join(
    "\u0000",
  );
}

function logicalAttachmentScopeKey(scope: ConversationDiagnosticAttachmentScope): string {
  const workspaceKey = scope.workspaceIdentity?.trim() || scope.workspacePath;
  return [scope.remoteSessionId ?? "__base__", workspaceKey].join("\u0000");
}

function sameScope(
  left: ConversationDiagnosticAttachmentScope,
  right: ConversationDiagnosticAttachmentScope,
): boolean {
  return (
    (left.remoteSessionId ?? "__base__") === (right.remoteSessionId ?? "__base__") &&
    (left.workspaceIdentity?.trim() || left.workspacePath) ===
      (right.workspaceIdentity?.trim() || right.workspacePath)
  );
}

function acquireSupervisor(
  scope: ConversationDiagnosticAttachmentScope,
  services: IServiceAccessor,
): SupervisorLease {
  const logicalScopeKey = logicalAttachmentScopeKey(scope);
  const key = attachmentScopeKey(scope, services.zcodeAgentService);
  // service generation 换代时，零引用旧 supervisor 立即销毁；仍被 pane 使用的旧代标 stale，
  // 等末位 lease 释放再清理。不能让旧/新 generation 同时长期订阅同一 workspace。
  for (const [candidateKey, candidate] of supervisorRegistry) {
    if (candidate.logicalScopeKey !== logicalScopeKey || candidateKey === key) {
      continue;
    }
    supervisorRegistry.delete(candidateKey);
    candidate.stale = true;
    if (candidate.refCount === 0) disposeSupervisorEntry(candidate);
  }
  let entry = supervisorRegistry.get(key);
  if (entry) {
    entry.refCount += 1;
  } else {
    entry = {
      key,
      logicalScopeKey,
      supervisor: new ConversationDiagnostics(),
      refCount: 1,
      subscription: null,
      stale: false,
      workspaceDetached: false,
    };
    supervisorRegistry.set(key, entry);
  }
  let released = false;
  return {
    entry,
    release: () => {
      if (released) return;
      released = true;
      entry.refCount -= 1;
      if (entry.refCount > 0) return;
      if (entry.stale || entry.workspaceDetached) {
        disposeSupervisorEntry(entry);
      }
      // ref=0 的当前 generation 仍保留 live subscription。关闭 pane 不能等价于
      // workspace detach，否则超过 SessionDataLayer 30s keep-warm 的后台 terminal 会丢。
    },
  };
}

function disposeSupervisorEntry(entry: SupervisorRegistryEntry): void {
  if (supervisorRegistry.get(entry.key) === entry) {
    supervisorRegistry.delete(entry.key);
  }
  entry.subscription?.dispose();
  entry.subscription = null;
  entry.supervisor.dispose();
}

/** 窗口/测试销毁边界；生产 page 生命周期结束时不保留 orphan subscription。 */
export function disposeConversationDiagnostics(): void {
  for (const entry of supervisorRegistry.values()) {
    disposeSupervisorEntry(entry);
  }
  supervisorRegistry.clear();
}

/**
 * Root tab 事实源裁决 workspace detach。切 task/切 tab 不会移除 scope；真正关闭最后一个
 * workspace tab 才标记 detached，零引用立即销毁，有存量 pane 则等其 release 后销毁。
 */
export function reconcileConversationDiagnosticWorkspaceScopes(
  scopes: readonly ConversationDiagnosticAttachmentScope[],
): void {
  const attachedKeys = new Set(scopes.map(logicalAttachmentScopeKey));
  for (const entry of supervisorRegistry.values()) {
    entry.workspaceDetached = !attachedKeys.has(entry.logicalScopeKey);
    if (entry.workspaceDetached && entry.refCount === 0) {
      disposeSupervisorEntry(entry);
    }
  }
}

function ensureSupervisorSubscription(
  entry: SupervisorRegistryEntry,
  scope: ConversationDiagnosticAttachmentScope,
  services: IServiceAccessor,
): void {
  if (entry.subscription) return;
  const telemetryService = createConversationTelemetryService(services.zcodeAgentService);
  const factEvent = telemetryService.onFact({
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
  });
  entry.subscription = factEvent((fact: ConversationTelemetryFact) =>
    entry.supervisor.handleFact(fact),
  );
}

const ConversationDiagnosticAttachmentContext =
  createContext<ConversationDiagnosticAttachmentValue | null>(null);

/**
 * 窗口 workspace/service attachment：生命周期高于 pane 和 SessionDataLayer keep-warm。
 * 只订阅已有本地事实，不安装网络 exporter。
 */
export function ConversationDiagnosticWorkspaceAttachment({
  enabled,
  foregroundEnabled = true,
  services,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  children,
}: ConversationDiagnosticAttachmentScope & {
  enabled: boolean;
  foregroundEnabled?: boolean;
  services: IServiceAccessor;
  children: ReactNode;
}) {
  const scope = useMemo<ConversationDiagnosticAttachmentScope>(
    () => ({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [remoteSessionId, workspaceIdentity, workspacePath],
  );
  const lease = useMemo(() => {
    const agentService = services.zcodeAgentService as object | null | undefined;
    if (!enabled || !agentService) return null;
    // Bug 根因：Root 的隔离渲染和远端 service 准备阶段可能尚无 PlatformProvider 或 agent service。
    // telemetry 是旁路能力，不能因依赖未就绪阻断 workspace 主界面；依赖齐备后再按 generation 建 lease。
    return acquireSupervisor(scope, services);
  }, [enabled, scope, services]);
  const supervisor = lease?.entry.supervisor ?? null;

  useEffect(() => {
    if (!lease) return undefined;
    ensureSupervisorSubscription(lease.entry, scope, services);
    return () => {
      lease.release();
    };
  }, [lease, scope, services]);

  const value = useMemo<ConversationDiagnosticAttachmentValue | null>(
    () => (supervisor ? { scope, supervisor, foregroundEnabled } : null),
    [foregroundEnabled, scope, supervisor],
  );
  return (
    <ConversationDiagnosticAttachmentContext.Provider value={value}>
      {children}
    </ConversationDiagnosticAttachmentContext.Provider>
  );
}

/** pane 使用自己的 ready service/scope 覆盖 context；Web 根 attachment 为 null 时保持 no-op。 */
export function ConversationDiagnosticPaneAttachment({
  services,
  scope,
  children,
}: {
  services: IServiceAccessor;
  scope: ConversationDiagnosticAttachmentScope;
  children: ReactNode;
}) {
  const parentAttachment = useContext(ConversationDiagnosticAttachmentContext);
  return (
    <ConversationDiagnosticWorkspaceAttachment
      enabled={parentAttachment !== null}
      foregroundEnabled={parentAttachment?.foregroundEnabled ?? false}
      services={services}
      workspacePath={scope.workspacePath}
      workspaceIdentity={scope.workspaceIdentity}
      remoteSessionId={scope.remoteSessionId}
    >
      {children}
    </ConversationDiagnosticWorkspaceAttachment>
  );
}

export function useScopedConversationDiagnostics(
  scope: ConversationDiagnosticAttachmentScope,
): ConversationDiagnostics | null {
  const attachment = useContext(ConversationDiagnosticAttachmentContext);
  return attachment && sameScope(attachment.scope, scope) ? attachment.supervisor : null;
}

export function useScopedConversationDiagnosticForegroundEnabled(
  scope: ConversationDiagnosticAttachmentScope,
): boolean {
  const attachment = useContext(ConversationDiagnosticAttachmentContext);
  return Boolean(attachment && attachment.foregroundEnabled && sameScope(attachment.scope, scope));
}
