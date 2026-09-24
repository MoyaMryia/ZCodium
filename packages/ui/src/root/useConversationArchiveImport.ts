import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONVERSATION_ARCHIVE_LIMITS, type IPlatformService } from "@zcode/shared";
import type { ImportConversationShareInput } from "@zcode/services";
type IntlShape = ReturnType<typeof import("@/i18n/IntlProvider.js").useZCodeIntl>["intl"];
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { seedImportedSessionDraft } from "@/v4/composer/newTaskDraft.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import type { WindowTabState } from "@/store/tabStore.js";
import { dismissToast, toast, updateToast } from "@/components/ui/toast.js";
import { importConversationArchive } from "@/lib/importConversationArchive.js";
import { logger } from "@/logger.js";

interface Options {
  platform: IPlatformService;
  locale: "zh-CN" | "en-US";
  intl: IntlShape;
  tabs: WindowTabState[];
  activeWorkspacePath?: string | null;
  activeWorkspaceIdentity?: string | null;
  activateTabByPath: (path: string, options?: { workspaceIdentity?: string }) => boolean;
  addTab: (
    path: string,
    options?: { workspaceIdentity?: string; workspacePurpose?: "conversation" },
  ) => void;
}

function failurePresentation(error: unknown): {
  messageId: string;
  retryable: boolean;
  kind: string;
} {
  const kind =
    error && typeof error === "object" && "kind" in error && typeof error.kind === "string"
      ? error.kind
      : "unknown";
  const messageId =
    kind === "limit_exceeded"
      ? "conversationShare.import.fileTooLarge"
      : kind === "unsupported_schema_version"
        ? "conversationShare.import.unsupportedVersion"
        : kind === "invalid_contract"
          ? "conversationShare.import.integrityFailed"
          : kind === "feature_disabled"
            ? "conversationShare.error.featureDisabled"
            : "conversationShare.import.failed";
  return {
    kind,
    messageId,
    retryable: ![
      "invalid_contract",
      "limit_exceeded",
      "unsupported_schema_version",
      "feature_disabled",
    ].includes(kind),
  };
}

/** 窗口级选择/反馈 owner；Host 事务是会话提交的唯一事实来源。 */
export function useConversationArchiveImport(options: Options) {
  const service = useOptionalBaseWorkspaceServices()?.conversationShareService;
  const { platform, intl, locale, activateTabByPath, addTab } = options;
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const failureToast = useRef<number | null>(null);
  const progressToast = useRef<number | null>(null);
  useEffect(() => {
    const current = ++generation.current;
    setAvailable(false);
    busyRef.current = false;
    setBusy(false);
    if (service && platform.selectFileData)
      void service.canImport().then(
        (value) => {
          if (generation.current === current) setAvailable(value);
        },
        () => {},
      );
    return () => {
      generation.current++;
      if (failureToast.current !== null) dismissToast(failureToast.current);
      if (progressToast.current !== null) dismissToast(progressToast.current);
      progressToast.current = null;
    };
  }, [platform, service]);

  const runImport = useCallback(
    async function run(
      data: ArrayBuffer,
      input: Omit<ImportConversationShareInput, "archiveId">,
    ): Promise<void> {
      if (!service) return;
      if (failureToast.current !== null) dismissToast(failureToast.current);
      failureToast.current = null;
      const owner = generation.current;
      const operationId = `archive-import-${crypto.randomUUID()}`;
      let toastId: number | null = null;
      let subscription: { dispose(): void } | undefined;
      const dismissProgress = () => {
        if (toastId === null) return;
        dismissToast(toastId);
        if (progressToast.current === toastId) progressToast.current = null;
        toastId = null;
      };
      const showProgress = (message: string) => {
        if (generation.current !== owner) return;
        if (toastId === null)
          toastId = toast(message, { durationMs: 0, variant: "info", dismissible: false });
        else updateToast(toastId, { message });
        progressToast.current = toastId;
      };
      try {
        showProgress(intl.formatMessage({ id: "conversationShare.import.validating" }));
        subscription = service.onDynamicImportProgress(operationId)((progress) => {
          if (progress.phase === "complete") return;
          showProgress(
            intl.formatMessage({
              id:
                progress.phase === "installing"
                  ? "conversationShare.import.installing"
                  : progress.phase === "committing"
                    ? "conversationShare.import.committing"
                    : "conversationShare.import.validating",
            }),
          );
        });
        const result = await importConversationArchive(service, data, input, operationId);
        if (generation.current !== owner) return;
        seedImportedSessionDraft(result);
        if (
          !activateTabByPath(
            result.workspacePath,
            result.workspaceIdentity ? { workspaceIdentity: result.workspaceIdentity } : undefined,
          )
        ) {
          addTab(result.workspacePath, {
            workspaceIdentity: result.workspaceIdentity,
            workspacePurpose: "conversation",
          });
        }
        const store = useZCodeSessionStore.getState();
        store.setActiveTaskId(result.workspacePath, result.sessionId, result.workspaceIdentity);
        store.requestTimelineBottom(
          result.workspacePath,
          result.sessionId,
          result.workspaceIdentity,
        );
        const message = intl.formatMessage(
          {
            id:
              result.fallbackReason === "remote_workspace"
                ? "conversationShare.import.fallbackRemoteWorkspace"
                : result.reused
                  ? "conversationShare.import.reopened"
                  : "conversationShare.import.source",
          },
          { title: result.title, workspacePath: result.workspacePath },
        );
        dismissProgress();
        toast(message, { durationMs: result.fallbackReason === "remote_workspace" ? 7000 : 3000 });
      } catch (error) {
        if (generation.current !== owner) return;
        const presentation = failurePresentation(error);
        logger.warn("[conversation-import] 导入失败", { kind: presentation.kind });
        dismissProgress();
        failureToast.current = toast(intl.formatMessage({ id: presentation.messageId }), {
          // 默认 Toast 不渲染 action；使用 warning 才能让失败后的重试按钮实际可见。
          variant: "warning",
          durationMs: presentation.retryable ? 0 : 7000,
          dismissible: true,
          dismissLabel: intl.formatMessage({ id: "common.close" }),
          ...(presentation.retryable
            ? {
                actionLabel: intl.formatMessage({ id: "conversationShare.import.retry" }),
                onAction: () => {
                  if (generation.current !== owner || busyRef.current) return;
                  busyRef.current = true;
                  setBusy(true);
                  void run(data, input);
                },
              }
            : {}),
        });
      } finally {
        subscription?.dispose();
        dismissProgress();
        // 旧 Host 的异步收尾不能解除新 Host 的 busy 状态。
        if (generation.current === owner) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    },
    [activateTabByPath, addTab, intl, service],
  );

  const open = useCallback(() => {
    if (!available || !platform.selectFileData || busyRef.current) return;
    if (failureToast.current !== null) dismissToast(failureToast.current);
    failureToast.current = null;
    const owner = generation.current;
    const activeTab = options.tabs.find(
      (tab) =>
        tab.kind === "workspace" &&
        (tab.workspaceIdentity?.trim() || tab.workspacePath) ===
          (options.activeWorkspaceIdentity?.trim() || options.activeWorkspacePath),
    );
    const input: Omit<ImportConversationShareInput, "archiveId"> = {
      clientRequestId: crypto.randomUUID(),
      locale,
      targetWorkspacePath: options.activeWorkspacePath ?? undefined,
      targetWorkspaceIdentity: options.activeWorkspaceIdentity ?? undefined,
      targetWorkspaceKind:
        activeTab?.kind === "workspace" && (activeTab.remoteSessionId || activeTab.remoteTarget)
          ? "remote"
          : "local",
    };
    busyRef.current = true;
    setBusy(true);
    void platform
      .selectFileData({ accept: ".zcodium", maxBytes: CONVERSATION_ARCHIVE_LIMITS.archiveBytes })
      .then(async (file) => {
        if (generation.current !== owner) return;
        if (file) await runImport(file.data, input);
        else {
          busyRef.current = false;
          setBusy(false);
        }
      })
      .catch((error) => {
        if (generation.current !== owner) return;
        busyRef.current = false;
        setBusy(false);
        toast(intl.formatMessage({ id: failurePresentation(error).messageId }));
      });
  }, [
    available,
    intl,
    locale,
    options.activeWorkspaceIdentity,
    options.activeWorkspacePath,
    options.tabs,
    platform,
    runImport,
  ]);
  return useMemo(() => ({ available, busy, open }), [available, busy, open]);
}
