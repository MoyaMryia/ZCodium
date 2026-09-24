/* eslint-disable max-lines -- 定时任务主视图集中维护列表、创建/编辑整页路由与启停/删除操作，集中更利于交互一致。 */
import { useCallback, useEffect, useState, type ComponentType, type SVGProps } from "react";
import { CircleCheck, RotateCcw, TriangleAlert } from "lucide-react";
import {
  AUTOMATION_CREATE_LIMIT,
  TID_AUTOMATION_ACTION_DELETE,
  TID_AUTOMATION_ACTION_TOGGLE,
  TID_AUTOMATION_CARD,
  TID_AUTOMATION_CARD_MENU,
  TID_AUTOMATIONS_LIST,
  TID_AUTOMATIONS_STATUS_FILTER,
  isAutomationCreateLimitError,
  resolveWorkspaceKey,
  type ZCodeAutomation,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { Spinner } from "@/components/ui/spinner.js";
import { toast as showToast, type ToastOptions } from "@/components/ui/toast.js";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import { AutomationScheduledTemplateIcon } from "@/settings/AutomationScheduledTemplateIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { logger } from "@/logger.js";

import {
  useAutomationManagementStore,
  type AutomationRunNowResult,
} from "@/store/automationManagementStore.js";
import {
  formatAutomationCardNextRun,
  hasAutomationFailureState,
  resolveAutomationStatusKind,
  type AutomationStatusKind,
} from "@/settings/automationFormat.js";
import { describeAutomationCardSchedule } from "@/settings/automationCardSchedule.js";
import { AutomationEditView, type AutomationEditSubmit } from "@/settings/AutomationEditView.js";
import { AutomationScheduleBadge } from "@/settings/AutomationScheduleBadge.js";
import {
  AutomationClockIcon,
  AutomationContinueIcon,
  AutomationCreateDropdown,
  AutomationEditActionIcon,
  AutomationKeepAwakeNotice,
  AutomationMoreHorizontalIcon,
  AutomationPauseActionIcon,
  AutomationPausedIcon,
  AutomationRefreshIcon,
  AutomationRunNowIcon,
  AutomationTrashIcon,
} from "@/settings/AutomationDesignPrimitives.js";
import { SETTINGS_FRAME_CONTENT_CLASSNAME } from "@/settings/SettingsPageParts.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import {
  AUTOMATION_STATUS_FILTERS,
  DEFAULT_AUTOMATION_STATUS_FILTER,
  filterAutomationsByStatus,
  type AutomationStatusFilter,
} from "@/settings/automationStatusFilter.js";
import { isRemoteAutomationWorkspace } from "@/hooks/useAutomationProjectOptions.js";

import {
  materializeScheduledTemplateDraft,
  resolveAutomationTemplateText,
  type ScheduledAutomationTemplate,
} from "@/settings/automationTemplateCatalog.js";
import { useAutomationTemplates } from "@/settings/useAutomationTemplates.js";
import type { AutomationsNavigationTab } from "@/lib/taskNavigationHistory.js";
import {
  AutomationsPageTitle,
  type AutomationsPageTab,
} from "@/settings/saved-workflows/AutomationsPageTitleSwitch.js";
import { useDynamicWorkflowAvailability } from "@/hooks/useDynamicWorkflowAvailability.js";
import {
  readAutomationsPageTab,
  writeAutomationsPageTab,
} from "@/settings/saved-workflows/automationsPageTabMemory.js";
import {
  SavedWorkflowsSection,
  type SavedWorkflowLaunchTarget,
  type SavedWorkflowProjectTarget,
  type SavedWorkflowsOpenArtifactParams,
  type SavedWorkflowsOpenRunParams,
  type SavedWorkflowsOpenTarget,
} from "@/settings/saved-workflows/SavedWorkflowsSection.js";
import { AutomationTemplateSkeletonGrid } from "@/settings/AutomationTemplateSkeletonGrid.js";

interface AutomationsSectionProps {
  workspacePath?: string | null;
  workspaceIdentity?: string;
  /** 「Create via chat」:切到会话让 agent 用 CronCreate 创建;缺省则回退到手动创建整页。
   * target = 工作流所属项目；定时任务的「通过对话创建」不带 target，落到活动项目。 */
  onCreateViaChat?: (prompt: string, target?: SavedWorkflowProjectTarget) => void;
  /** 会话内创建卡片的详情导航目标；定位成功后由调用方清空。 */
  openAutomationId?: string | null;
  /** 推荐提示词携带的一次性 tab 导航目标；旧 idle 入口回到自动化首页。"workflow" 落到顶级「工作流」标签。 */
  openAutomationTab?: AutomationsNavigationTab | null;
  onOpenAutomationConsumed?: () => void;
  /** 工作流「运行」= GUI 直接启动：accepted 后切到新会话。 */
  onNavigateToLaunchedRun?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
  /** 工作流运行历史「查看实例」：切到发起它的会话并打开实例详情页。 */
  onOpenWorkflowRun?: (params: SavedWorkflowsOpenRunParams) => void;
  /** 产物 chip → `workflow-artifact` tab。 */
  onOpenWorkflowArtifact?: (params: SavedWorkflowsOpenArtifactParams) => void;
  /** 深链直接落到详情页；透传给 SavedWorkflowsSection，定位后由调用方清空。global 只需 name。 */
  openWorkflow?: SavedWorkflowsOpenTarget | null;
  onOpenWorkflowConsumed?: () => void;
  /** 打开某次运行关联的会话；管理页列出所有项目，必须携带 automation 所属 workspace。 */
  onOpenSession?: (params: {
    sessionId: string;
    workspacePath: string;
    workspaceIdentity?: string;
  }) => void;
}

export const AUTOMATIONS_TOAST_ANCHOR_ID = "automations-main-toast-anchor";

function toast(message: string, options?: ToastOptions): number {
  return showToast(message, {
    ...options,
    anchorId: AUTOMATIONS_TOAST_ANCHOR_ID,
  });
}

/** 创建表单的预填草稿(来自「More ideas」模板)。 */
interface AutomationDraft {
  templateId?: string;
  title: string;
  cronExpr: string;
  prompt: string;
}

/** 主视图内部路由:列表 / 新建 / 编辑。 */
type AutomationsView =
  | { mode: "list" }
  | { mode: "create"; draft: AutomationDraft | null }
  | { mode: "edit"; automation: ZCodeAutomation };

const STATUS_META: Record<
  AutomationStatusKind,
  { icon: ComponentType<SVGProps<SVGSVGElement>>; className: string }
> = {
  active: { icon: AutomationClockIcon, className: "text-success" },
  // 设计稿的暂停态是 stop-circle 描边图标，不能回退为圆圈内实心方块。
  paused: { icon: AutomationPausedIcon, className: "text-foreground-subtle" },
  completed: { icon: CircleCheck, className: "text-foreground-subtle" },
  failed: { icon: TriangleAlert, className: "text-destructive" },
};

function automationPromptSummary(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : " ";
}

function canRestartAutomation(automation: Pick<ZCodeAutomation, "lifecycleStatus">): boolean {
  return automation.lifecycleStatus === "failed";
}

function canToggleAutomation(automation: Pick<ZCodeAutomation, "lifecycleStatus">): boolean {
  return automation.lifecycleStatus !== "completed" && automation.lifecycleStatus !== "failed";
}

function getAutomationRunNowToastId(
  result: AutomationRunNowResult,
): "automations.runNowQueued" | "automations.runNowAlreadyRunning" | "automations.runNowFailed" {
  if (result === "queued") return "automations.runNowQueued";
  if (result === "duplicate") return "automations.runNowAlreadyRunning";
  return "automations.runNowFailed";
}

type AutomationActionError = "create" | "update" | "toggle" | "restart" | "delete";

/** 原始 Agent/RPC 错误留在 logger；界面只展示当前动作对应的可理解提示。 */
function getAutomationActionErrorToastId(action: AutomationActionError): string {
  return `automations.error.${action}`;
}

function getAutomationCreateErrorToastId(error: unknown): string {
  return isAutomationCreateLimitError(error)
    ? "automations.error.createLimit"
    : getAutomationActionErrorToastId("create");
}

function resolveAutomationDetailTarget(
  automations: readonly ZCodeAutomation[],
  automationId?: string | null,
): ZCodeAutomation | null {
  const targetId = automationId?.trim();
  if (!targetId) return null;
  return automations.find((automation) => automation.automationId === targetId) ?? null;
}

function resolveAutomationDetailNavigation(
  automations: readonly ZCodeAutomation[],
  automationId: string | null | undefined,
  listReady: boolean,
): { status: "pending" } | { status: "missing" } | { status: "found"; target: ZCodeAutomation } {
  if (!automationId?.trim() || !listReady) return { status: "pending" };
  const target = resolveAutomationDetailTarget(automations, automationId);
  return target ? { status: "found", target } : { status: "missing" };
}

interface AutomationActionsMenuProps {
  automation: ZCodeAutomation;
  busy: boolean;
  canRestart: boolean;
  canToggle: boolean;
  onRunNow: (automation: ZCodeAutomation) => void;
  onEdit: (automation: ZCodeAutomation) => void;
  onToggle: (automation: ZCodeAutomation, enabled: boolean) => void;
  onRestart: (automation: ZCodeAutomation) => void;
  onDelete: (automation: ZCodeAutomation) => void;
}

function AutomationActionsMenu({
  automation,
  busy,
  canRestart,
  canToggle,
  onRunNow,
  onEdit,
  onToggle,
  onRestart,
  onDelete,
}: AutomationActionsMenuProps) {
  const { intl } = useZCodeIntl();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md opacity-100 transition-colors hover:bg-hover md:opacity-0 md:group-hover:opacity-100 data-[state=open]:bg-hover data-[state=open]:opacity-100"
          data-testid={TID_AUTOMATION_CARD_MENU}
          aria-label={intl.formatMessage({ id: "automations.moreActions" })}
          disabled={busy}
          // 卡片可点进编辑;菜单点击不冒泡到卡片。
          onClick={(event) => event.stopPropagation()}
        >
          <AutomationMoreHorizontalIcon
            className="size-4 text-foreground-subtle"
            aria-hidden="true"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="w-[190px]"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 立即运行：当前 RPC 期间用 busy 防重，返回后恢复入口；活动 run 由 host single-flight 判重。 */}
        <DropdownMenuItem
          className="gap-1"
          disabled={busy}
          onSelect={() => void onRunNow(automation)}
        >
          <span className="flex size-5 items-center justify-center">
            <AutomationRunNowIcon className="size-4" aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "automations.runNow" })}
        </DropdownMenuItem>
        {canRestart ? (
          <DropdownMenuItem
            className="gap-1"
            disabled={busy}
            onSelect={() => void onRestart(automation)}
          >
            <span className="flex size-5 items-center justify-center">
              <RotateCcw className="size-4" strokeWidth={1.33} aria-hidden="true" />
            </span>
            {intl.formatMessage({ id: "automations.restart" })}
          </DropdownMenuItem>
        ) : null}
        {/* 终态任务不展示 pause/resume：failed 可 Restart，completed 彻底收口只保留查看/删除。 */}
        {canToggle ? (
          <DropdownMenuItem
            data-testid={TID_AUTOMATION_ACTION_TOGGLE}
            className="gap-1"
            disabled={busy}
            onSelect={() => void onToggle(automation, !automation.enabled)}
          >
            {automation.enabled ? (
              <span className="flex size-5 items-center justify-center">
                <AutomationPauseActionIcon className="size-4" aria-hidden="true" />
              </span>
            ) : (
              <span className="flex size-5 items-center justify-center">
                <AutomationContinueIcon className="size-4" aria-hidden="true" />
              </span>
            )}
            {intl.formatMessage({
              id: automation.enabled ? "automations.pause" : "automations.resume",
            })}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          className="gap-1"
          disabled={busy}
          onSelect={() => void onEdit(automation)}
        >
          <span className="flex size-5 items-center justify-center">
            <AutomationEditActionIcon className="size-4" aria-hidden="true" />
          </span>
          {intl.formatMessage({ id: "automations.form.editTitle" })}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          data-testid={TID_AUTOMATION_ACTION_DELETE}
          className="gap-1 !text-destructive data-[highlighted]:!bg-menu-hover data-[highlighted]:!text-destructive focus:!text-destructive [&_svg]:!text-destructive"
          disabled={busy}
          onSelect={() => void onDelete(automation)}
        >
          <AutomationTrashIcon />
          {intl.formatMessage({ id: "automations.delete" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 状态筛选命中 0 条时的占位；使用统一卡片描边，文案与「还没有任务」区分开。 */
function AutomationStatusFilterEmpty() {
  const { intl } = useZCodeIntl();
  return (
    <div className="rounded-[10px] border border-card-border px-3 py-3 text-ui-base text-foreground-subtle">
      {intl.formatMessage({ id: "automations.statusFilter.empty" })}
    </div>
  );
}

export function AutomationsSection({
  workspacePath,
  workspaceIdentity,
  onCreateViaChat,
  openAutomationId,
  openAutomationTab,
  onOpenAutomationConsumed,
  onNavigateToLaunchedRun,
  onOpenWorkflowRun,
  onOpenWorkflowArtifact,
  openWorkflow,
  onOpenWorkflowConsumed,
  onOpenSession,
}: AutomationsSectionProps) {
  const { intl, locale } = useZCodeIntl();
  const { clientScenesService, zcodeAgentService } = useServices();
  const confirmDialog = useConfirmDialog();
  const { settings: sharedSettings, update: updateSharedSettings } = useSettings();

  const automations = useAutomationManagementStore((state) => state.automations);
  const automationCreateLimitReached = automations.length >= AUTOMATION_CREATE_LIMIT;
  const loading = useAutomationManagementStore((state) => state.loading);
  const operationId = useAutomationManagementStore((state) => state.operationId);
  const runsCache = useAutomationManagementStore((state) => state.runsCache);
  const initialize = useAutomationManagementStore((state) => state.initialize);
  const createAutomation = useAutomationManagementStore((state) => state.createAutomation);
  const updateAutomation = useAutomationManagementStore((state) => state.updateAutomation);
  const deleteAutomation = useAutomationManagementStore((state) => state.deleteAutomation);
  const setEnabled = useAutomationManagementStore((state) => state.setEnabled);
  const restartAutomation = useAutomationManagementStore((state) => state.restartAutomation);
  const runAutomationNow = useAutomationManagementStore((state) => state.runAutomationNow);
  const loadRuns = useAutomationManagementStore((state) => state.loadRuns);
  const deleteRun = useAutomationManagementStore((state) => state.deleteRun);
  const refresh = useAutomationManagementStore((state) => state.refresh);

  const automationTemplates = useAutomationTemplates(clientScenesService);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<AutomationsView>({ mode: "list" });
  const [statusFilter, setStatusFilter] = useState<AutomationStatusFilter>(
    DEFAULT_AUTOMATION_STATUS_FILTER,
  );
  // 动态工作流灰度：未命中就没有「工作流」标签，
  // 页面退回单一的「自动化」。快照未就绪时 enabled 为 false，宁可标题晚半拍长出切换，也不先闪
  // 一个标签再收起——中枢很少是用户进 app 后第一眼看的东西。
  const { enabled: dynamicWorkflowEnabled } = useDynamicWorkflowAvailability();
  // 顶级标签「自动化 / 工作流」：页标题即切换。中枢已是跨项目视图，记忆不再按项目分桶，用 app 级单 key。
  const [storedPageTab, setPageTabState] = useState<AutomationsPageTab>(() =>
    readAutomationsPageTab(),
  );
  // 灰度关时忽略 sessionStorage 里记住的「工作流」：只收窄读出来的值，记忆本身不清，
  // 灰度再开时用户仍然回到上次那一页。中枢只在 `pageTab === "workflow"` 分支挂载，
  // 收窄 pageTab 等于 SavedWorkflowsSection 永不挂载，不会有一帧的误挂载去发查询。
  const pageTab: AutomationsPageTab = dynamicWorkflowEnabled ? storedPageTab : "automation";
  const setPageTab = useCallback((next: AutomationsPageTab) => {
    setPageTabState(next);
    writeAutomationsPageTab(next);
  }, []);
  const activeWorkspaceTab = useTabStore((state) => {
    const activeTab = state.tabs.find((candidate) => candidate.id === state.activeTabId);
    return activeTab && isWorkspaceTab(activeTab) ? activeTab : undefined;
  });
  const currentWorkspaceIsRemote = isRemoteAutomationWorkspace(activeWorkspaceTab);
  const hasAnyTasks = automations.length > 0;
  const visibleAutomations = filterAutomationsByStatus(automations, statusFilter);
  const [loadedWorkspaceKey, setLoadedWorkspaceKey] = useState<string | null>(null);
  // 相对时间基准;刷新列表时更新,避免频繁 setInterval。
  const [now, setNow] = useState(() => Date.now());

  // 列表按当前项目加载(主视图由 WorkspaceShellLayout 传入当前 workspace)。
  useEffect(() => {
    if (!workspacePath) return;
    const workspaceKey = resolveWorkspaceKey({
      workspacePath,
      workspaceIdentity,
    });
    let disposed = false;
    setLoadedWorkspaceKey(null);
    setNow(Date.now());
    void initialize({
      workspacePath,
      workspaceIdentity,
      agentService: zcodeAgentService,
    }).then(() => {
      if (!disposed) setLoadedWorkspaceKey(workspaceKey);
    });
    return () => {
      disposed = true;
    };
  }, [workspacePath, workspaceIdentity, zcodeAgentService, initialize]);

  useEffect(() => {
    if (!openAutomationTab) return;
    // 灰度关：请求的「工作流」标签不存在，
    // 落到「自动化」并把深链消费掉——不消费会让请求一直挂着，反复把页面拉回来。
    if (openAutomationTab === "workflow" && !dynamicWorkflowEnabled) {
      setPageTab("automation");
      onOpenAutomationConsumed?.();
      return;
    }
    if (openAutomationTab === "workflow") {
      setPageTab("workflow");
      onOpenAutomationConsumed?.();
      return;
    }
    // 详情导航由下一条 effect 唯一消费，不能先清掉尚在等待列表的 id。
    if (openAutomationId?.trim()) return;
    setPageTab("automation");
    onOpenAutomationConsumed?.();
  }, [
    dynamicWorkflowEnabled,
    onOpenAutomationConsumed,
    openAutomationId,
    openAutomationTab,
    setPageTab,
  ]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh(zcodeAgentService);
      setNow(Date.now());
    } finally {
      setRefreshing(false);
    }
  }, [refresh, zcodeAgentService]);

  const showAutomationCreateLimitToast = useCallback(() => {
    toast(
      intl.formatMessage(
        { id: "automations.error.createLimit" },
        { limit: String(AUTOMATION_CREATE_LIMIT) },
      ),
    );
  }, [intl]);

  useEffect(() => {
    const currentWorkspaceKey = workspacePath
      ? resolveWorkspaceKey({ workspacePath, workspaceIdentity })
      : null;
    const result = resolveAutomationDetailNavigation(
      automations,
      openAutomationId,
      currentWorkspaceKey !== null && loadedWorkspaceKey === currentWorkspaceKey,
    );
    if (result.status === "pending") return;
    setPageTab("automation");
    if (result.status === "found") {
      setView({ mode: "edit", automation: result.target });
    } else {
      // 目标可能已删除或功能已退休；回到列表并消费一次，避免旧深链困在工作流/编辑页。
      setView({ mode: "list" });
      toast(intl.formatMessage({ id: "automations.error.targetNotFound" }));
    }
    onOpenAutomationConsumed?.();
  }, [
    automations,
    intl,
    loadedWorkspaceKey,
    onOpenAutomationConsumed,
    openAutomationId,
    setPageTab,
    workspaceIdentity,
    workspacePath,
  ]);

  const handleCreateManually = useCallback(() => {
    if (automationCreateLimitReached) {
      showAutomationCreateLimitToast();
      return;
    }
    setView({ mode: "create", draft: null });
  }, [automationCreateLimitReached, showAutomationCreateLimitToast]);

  // 「Create via chat」:交给 parent 切到会话视图;未提供则回退到手动创建整页。
  const handleCreateViaChat = useCallback(() => {
    if (automationCreateLimitReached) {
      showAutomationCreateLimitToast();
      return;
    }
    if (currentWorkspaceIsRemote) {
      // Automations 创建只能绑定本地项目；远端当前会话不能隐式成为创建目标。
      // 仍保留管理页，但把创建收敛到带本地项目选择器的表单。
      setView({ mode: "create", draft: null });
      return;
    }
    if (onCreateViaChat) {
      onCreateViaChat(intl.formatMessage({ id: "automations.createViaChat.prompt" }));
    } else setView({ mode: "create", draft: null });
  }, [
    automationCreateLimitReached,
    currentWorkspaceIsRemote,
    intl,
    onCreateViaChat,
    showAutomationCreateLimitToast,
  ]);

  const handleUseTemplate = useCallback(
    (template: ScheduledAutomationTemplate) => {
      if (automationCreateLimitReached) {
        showAutomationCreateLimitToast();
        return;
      }
      const draft = materializeScheduledTemplateDraft(template, locale);
      setView({
        mode: "create",
        draft,
      });
    },
    [automationCreateLimitReached, locale, showAutomationCreateLimitToast],
  );

  // 创建/编辑整页提交:创建可指定目标项目;编辑锁定原项目。
  const handleEditSubmit = useCallback(
    async ({
      input,
      workspacePath: targetPath,
      workspaceIdentity: targetIdentity,
    }: AutomationEditSubmit) => {
      if (view.mode === "edit") {
        const ok = await updateAutomation(view.automation.automationId, input, zcodeAgentService);
        if (!ok) {
          toast(
            intl.formatMessage({
              id: getAutomationActionErrorToastId("update"),
            }),
          );
        } else {
          setNow(Date.now());
        }
        return ok;
      }
      if (automationCreateLimitReached) {
        showAutomationCreateLimitToast();
        return false;
      }
      const created = await createAutomation(
        {
          ...(input as Parameters<typeof createAutomation>[0]),
          workspacePath: targetPath,
          workspaceIdentity: targetIdentity,
        },
        zcodeAgentService,
      );

      if (!created) {
        const createError = useAutomationManagementStore.getState().error;
        toast(
          intl.formatMessage(
            { id: getAutomationCreateErrorToastId(createError) },
            { limit: String(AUTOMATION_CREATE_LIMIT) },
          ),
        );
        return false;
      }
      setNow(Date.now());
      return true;
    },
    [
      automationCreateLimitReached,
      createAutomation,
      intl,
      showAutomationCreateLimitToast,
      updateAutomation,
      view,
      zcodeAgentService,
    ],
  );

  const handleToggle = useCallback(
    async (automation: ZCodeAutomation, enabled: boolean) => {
      await setEnabled(automation.automationId, enabled, zcodeAgentService);
      const message = useAutomationManagementStore.getState().error;
      if (message) toast(intl.formatMessage({ id: getAutomationActionErrorToastId("toggle") }));
      else {
        // 编辑页 view 持有进入页面时的 automation 对象；列表刷新不会自动替换
        // 这个局部对象，导致菜单点击 Pause/Resume 后文案仍停在旧状态。
        setView((prev) =>
          prev.mode === "edit" && prev.automation.automationId === automation.automationId
            ? {
                mode: "edit",
                automation: {
                  ...prev.automation,
                  enabled,
                  lifecycleStatus: enabled ? "active" : "paused",
                },
              }
            : prev,
        );
        setNow(Date.now());
      }
    },
    [intl, setEnabled, zcodeAgentService],
  );

  const handleRestart = useCallback(
    async (automation: ZCodeAutomation) => {
      await restartAutomation(automation.automationId, zcodeAgentService);
      const message = useAutomationManagementStore.getState().error;
      if (message)
        toast(
          intl.formatMessage({
            id: getAutomationActionErrorToastId("restart"),
          }),
        );
      else setNow(Date.now());
    },
    [intl, restartAutomation, zcodeAgentService],
  );

  const handleRunNow = useCallback(
    async (automation: ZCodeAutomation, source: "list" | "editor" = "list") => {
      logger.debug("[automations] 立即运行交互开始", {
        automationId: automation.automationId,
        source,
      });

      const result = await runAutomationNow(automation.automationId, zcodeAgentService);
      logger.debug("[automations] 立即运行交互结束", {
        automationId: automation.automationId,
        source,
        result,
      });
      if (result === "queued") {
        await loadRuns(automation.automationId, zcodeAgentService, true);
        const latestSessionId = useAutomationManagementStore
          .getState()
          .runsCache[automation.automationId]?.runs?.find(
            (run) => run.trigger === "manual" && Boolean(run.sessionId),
          )?.sessionId;
        toast(
          intl.formatMessage({ id: "scheduledPreview.toast.running" }, { title: automation.title }),
          {
            durationMs: 4000,
            position: "top-center",
            variant: "info",
            ...(latestSessionId && onOpenSession
              ? {
                  actionLabel: intl.formatMessage({
                    id: "scheduledPreview.toast.view",
                  }),
                  onAction: () =>
                    onOpenSession({
                      sessionId: latestSessionId,
                      workspacePath: automation.workspacePath,
                      workspaceIdentity: automation.workspaceIdentity,
                    }),
                }
              : {}),
            dismissible: true,
            dismissLabel: intl.formatMessage({ id: "common.close" }),
          },
        );
        setNow(Date.now());
      } else if (result === "duplicate") {
        // 连续点击或上一条 manual run 仍在执行时，store/host 会返回 duplicate。
        // 这里必须给出可见反馈，否则用户会以为按钮没响应。
        toast(intl.formatMessage({ id: getAutomationRunNowToastId(result) }));
      } else if (result === "failed") {
        toast(intl.formatMessage({ id: getAutomationRunNowToastId(result) }));
      }
    },
    [intl, loadRuns, onOpenSession, runAutomationNow, zcodeAgentService],
  );

  const handleDelete = useCallback(
    async (automation: ZCodeAutomation) => {
      const confirmed = await confirmDialog({
        presentation: "automation-confirmation",
        title: intl.formatMessage({ id: "automations.delete.title" }),
        description: intl.formatMessage(
          { id: "automations.delete.description" },
          { title: automation.title },
        ),
        confirmLabel: intl.formatMessage({ id: "common.delete" }),
        confirmVariant: "destructive",
        // 共享确认弹窗默认在按钮右侧渲染 esc / ⏎，在删除场景会被视为额外图标。
        // 定时任务删除按钮只保留动作文字，且不改变其他确认弹窗的键盘提示策略。
        showKeyboardHints: false,
      });
      if (!confirmed) return;

      await deleteAutomation(automation.automationId, zcodeAgentService);
      const message = useAutomationManagementStore.getState().error;
      if (message) toast(intl.formatMessage({ id: getAutomationActionErrorToastId("delete") }));
      // 若在编辑该任务的整页,删除后回列表。
      setView((prev) =>
        prev.mode === "edit" && prev.automation.automationId === automation.automationId
          ? { mode: "list" }
          : prev,
      );
    },
    [confirmDialog, deleteAutomation, intl, zcodeAgentService],
  );

  if (!workspacePath) {
    return (
      <div className="rounded-lg border border-card-border bg-card px-3 py-2 text-ui-base text-foreground-subtle">
        {intl.formatMessage({ id: "automations.noWorkspace" })}
      </div>
    );
  }

  // 创建/编辑整页(带 Settings/History tab)。
  if (view.mode !== "list") {
    return (
      <>
        <AutomationEditView
          editing={view.mode === "edit" ? view.automation : null}
          initialDraft={view.mode === "create" ? view.draft : null}
          defaultWorkspacePath={workspacePath}
          defaultWorkspaceIdentity={workspaceIdentity}
          saving={
            operationId?.startsWith("automation:create") ||
            operationId?.startsWith("automation:update") ||
            false
          }
          onBack={() => setView({ mode: "list" })}
          onSubmit={handleEditSubmit}
          onRunNow={(automation) => handleRunNow(automation, "editor")}
          onToggle={handleToggle}
          onDelete={(automation) => handleDelete(automation)}
          runsEntry={view.mode === "edit" ? runsCache[view.automation.automationId] : undefined}
          onLoadRuns={() => {
            if (view.mode === "edit")
              void loadRuns(view.automation.automationId, zcodeAgentService, true);
          }}
          onDeleteRun={(runId) => {
            if (view.mode === "edit") {
              void deleteRun(view.automation.automationId, runId, zcodeAgentService);
            }
          }}
          onOpenSession={
            view.mode === "edit" && onOpenSession
              ? (sessionId) => {
                  // 运行历史的跳转入口之前没有从父层接入导航回调，导致即使 run.sessionId
                  // 已经写入 automation_runs，菜单里也会把“跳到会话”隐藏掉。
                  onOpenSession({
                    sessionId,
                    workspacePath: view.automation.workspacePath,
                    workspaceIdentity: view.automation.workspaceIdentity,
                  });
                }
              : undefined
          }
        />
      </>
    );
  }

  // 页标题即顶级切换：「自动化 / 工作流」两个标题词
  // 并排，30/34 沿用 h1 的页面标题层级；副标题随标签换。
  const pageHeader = (
    <div className="flex flex-col gap-3">
      <AutomationsPageTitle
        workflowTabEnabled={dynamicWorkflowEnabled}
        value={pageTab}
        onValueChange={setPageTab}
      />
      <p className="text-ui-base leading-5 text-foreground-subtlest">
        {intl.formatMessage({
          id:
            pageTab === "workflow"
              ? "workflows.hub.description"
              : hasAnyTasks
                ? "automations.description.populated"
                : "automations.description",
        })}
      </p>
    </div>
  );

  if (pageTab === "workflow") {
    return (
      <SavedWorkflowsSection
        header={pageHeader}
        workspacePath={workspacePath}
        workspaceIdentity={workspaceIdentity}
        onNavigateToLaunchedRun={onNavigateToLaunchedRun}
        onCreateViaChat={onCreateViaChat}
        onOpenWorkflowRun={onOpenWorkflowRun}
        onOpenWorkflowArtifact={onOpenWorkflowArtifact}
        openWorkflow={openWorkflow}
        onOpenWorkflowConsumed={onOpenWorkflowConsumed}
      />
    );
  }

  return (
    <div data-automations-content className={cn(SETTINGS_FRAME_CONTENT_CLASSNAME, "flex flex-col")}>
      {pageHeader}

      {/* 有任务时顶栏提供刷新与创建；空态创建入口在大卡内。 */}
      {hasAnyTasks ? (
        <div className="mt-8 flex items-center justify-end">
          <div className="flex items-center gap-3">
            <ControlHintTooltip
              title={intl.formatMessage({
                id: refreshing ? "automations.refreshing" : "automations.refresh",
              })}
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={intl.formatMessage({ id: "automations.refresh" })}
                onClick={() => void handleRefresh()}
                disabled={refreshing}
              >
                <AutomationRefreshIcon
                  className={cn("size-3.5", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
              </Button>
            </ControlHintTooltip>
            <AutomationCreateDropdown
              onViaChat={handleCreateViaChat}
              onManually={handleCreateManually}
            />
          </div>
        </div>
      ) : null}

      {/* 筛选按卡片状态归类，保留进行中、已完成和失败任务。 */}
      {hasAnyTasks ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          data-testid={TID_AUTOMATIONS_STATUS_FILTER}
        >
          {AUTOMATION_STATUS_FILTERS.map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={statusFilter === key}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-ui-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
                statusFilter === key
                  ? "bg-selected text-foreground"
                  : "text-foreground-subtle hover:bg-hover hover:text-foreground",
              )}
              onClick={() => setStatusFilter(key)}
            >
              {intl.formatMessage({ id: `automations.statusFilter.${key}` })}
            </button>
          ))}
        </div>
      ) : null}

      {loading && automations.length === 0 ? (
        <div className="mt-8 flex h-40 items-center justify-center">
          <Spinner className="size-5" />
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col gap-8",
            // 列表态提示栏与 action row 旧间距为 16px，小于设计稿要求的 20px。
            hasAnyTasks ? "mt-5" : "mt-8",
          )}
        >
          <div className="flex w-full flex-col gap-4">
            {/* keep-awake 是全局开关（与设置页「常规」镜像），定时任务运行会话同样受益，
               列表态放在任务卡之前，空态保持大空卡在前。 */}
            {hasAnyTasks ? (
              <AutomationKeepAwakeNotice
                checked={sharedSettings?.keepAwakeWhileRunning ?? false}
                onChange={(value) =>
                  void updateSharedSettings({
                    keepAwakeWhileRunning: value,
                  })
                }
              />
            ) : null}

            <div data-automations-task-grid className="contents">
              {hasAnyTasks ? (
                <section className="flex w-full flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-ui-base font-medium leading-5 text-foreground-subtle">
                      {intl.formatMessage({ id: "automations.createdLabel" })}
                    </h2>
                  </div>
                  {visibleAutomations.length === 0 ? (
                    <AutomationStatusFilterEmpty />
                  ) : (
                    <div
                      data-testid={TID_AUTOMATIONS_LIST}
                      className={cn(
                        "grid grid-cols-1 auto-rows-[132px] gap-x-4 gap-y-4 lg:grid-cols-2",
                        // 设计规范最多露出 8 张卡片；grid 自身负责滚动。阈值按筛选后的数量算，
                        // 否则筛出少量卡片时仍锁高度会留下大块空白。
                        visibleAutomations.length > 8 &&
                          "max-h-[1198px] overflow-y-auto overscroll-contain lg:max-h-[606px]",
                      )}
                    >
                      {visibleAutomations.map((automation) => {
                        const status = resolveAutomationStatusKind(automation);
                        const hasFailure = hasAutomationFailureState(automation);
                        const statusMeta = STATUS_META[status];
                        const StatusIcon = statusMeta.icon;
                        const scheduleText = describeAutomationCardSchedule(automation, intl);
                        const formattedNextRun = formatAutomationCardNextRun(
                          automation.nextRunAt,
                          now,
                          intl,
                        );
                        // completed/paused/失败态的调度不再推进，但有限次任务跑完后
                        // nextRunAt 仍可能指向未来时刻，曾被拼进卡片误显“下次运行”。只有活跃
                        // 且未失败的卡片才追加下次运行时间，其余一律只展示频率摘要。
                        const scheduleCardText =
                          status === "active" && !hasFailure && formattedNextRun
                            ? `${scheduleText} · ${intl.formatMessage(
                                { id: "automations.nextRun" },
                                { when: formattedNextRun },
                              )}`
                            : scheduleText;
                        // Card 展示的是定时 + 手动派发的累计次数；maxRuns 只约束定时计划，
                        // 若作为分母会让用户误以为“立即运行”也消耗有限任务额度。
                        const runCountText = intl.formatMessage(
                          { id: "automations.runCount" },
                          { count: String(automation.runCount) },
                        );
                        const busy = operationId?.endsWith(`:${automation.automationId}`) ?? false;
                        // completed 表示有限次任务已经自然结束，不能再通过 Restart 复活；
                        // failed 才是可恢复终态，允许用户手动重排下一次运行。
                        const canRestart = canRestartAutomation(automation);
                        const canToggle = canToggleAutomation(automation);
                        return (
                          <div
                            key={automation.automationId}
                            data-testid={TID_AUTOMATION_CARD}
                            role="button"
                            tabIndex={0}
                            onClick={() => setView({ mode: "edit", automation })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setView({ mode: "edit", automation });
                              }
                            }}
                            className={cn(
                              // 任务卡与模板卡曾分别使用 surface/border，跨主题下描边深浅不一致。
                              "group relative flex h-full min-h-0 cursor-pointer gap-3 overflow-hidden rounded-xl border border-card-border bg-background p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused",
                              // 已完成任务保持静态弱化，不在 hover 时恢复透明度或改变背景。
                              status === "completed" ? "opacity-60" : "hover:bg-hover",
                            )}
                          >
                            <div className="flex h-full min-w-0 flex-1 flex-col gap-3">
                              <span className="block truncate pr-12 text-ui-base font-medium leading-5 text-foreground">
                                {automation.title}
                              </span>
                              <p className="text-wrap-phrase line-clamp-2 h-10 text-ui-base font-normal leading-5 text-foreground-subtle">
                                {automationPromptSummary(automation.prompt)}
                              </p>
                              <div className="mt-auto flex h-6 min-w-0 items-center gap-2 text-ui-base leading-5">
                                <div className="flex min-w-0 flex-1 items-center gap-2">
                                  {hasFailure ? (
                                    <>
                                      <span className="inline-flex shrink-0 items-center py-0.5 pl-1 pr-2 font-normal text-destructive">
                                        <span className="flex size-5 shrink-0 items-center justify-center">
                                          <TriangleAlert
                                            className="size-4"
                                            strokeWidth={1.33}
                                            aria-hidden="true"
                                          />
                                        </span>
                                        <span className="pl-1">
                                          {intl.formatMessage({
                                            id: "automations.lifecycle.failed",
                                          })}
                                        </span>
                                      </span>
                                      {/* 失败态也只展示 cron 摘要，禁止把已过期 nextRunAt 误写成“下次运行”。 */}
                                      <span className="inline-flex min-w-0 items-center rounded-md bg-success/10 py-0.5 pl-1 pr-2 font-normal text-success opacity-40">
                                        <span className="flex size-5 shrink-0 items-center justify-center">
                                          <AutomationClockIcon
                                            className="size-4"
                                            aria-hidden="true"
                                          />
                                        </span>
                                        <span className="truncate pl-1">{scheduleCardText}</span>
                                      </span>
                                    </>
                                  ) : status === "active" ? (
                                    <AutomationScheduleBadge
                                      text={scheduleCardText}
                                      icon={
                                        <StatusIcon
                                          className="size-4 shrink-0"
                                          strokeWidth={1.33}
                                          aria-hidden="true"
                                        />
                                      }
                                    />
                                  ) : (
                                    <>
                                      <span
                                        className={cn(
                                          "inline-flex shrink-0 items-center gap-1 font-normal",
                                          statusMeta.className,
                                        )}
                                      >
                                        <span className="flex size-5 shrink-0 items-center justify-center">
                                          <StatusIcon
                                            className="size-4 shrink-0"
                                            strokeWidth={1.33}
                                            aria-hidden="true"
                                          />
                                        </span>
                                        {intl.formatMessage({
                                          id: `automations.lifecycle.${status}`,
                                        })}
                                      </span>
                                      {status === "paused" || status === "completed" ? (
                                        /* 暂停/完成后调度不再推进，只展示 cron 摘要，不展示 nextRunAt。 */
                                        <AutomationScheduleBadge
                                          dimmed
                                          text={scheduleCardText}
                                          icon={
                                            <AutomationClockIcon
                                              className="size-4"
                                              aria-hidden="true"
                                            />
                                          }
                                        />
                                      ) : null}
                                    </>
                                  )}
                                </div>
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 items-center whitespace-nowrap rounded-md bg-surface px-1.5 py-0.5 text-ui-base font-normal text-foreground-subtle",
                                    (hasFailure || status === "paused") && "opacity-40",
                                  )}
                                >
                                  {runCountText}
                                </span>
                              </div>
                            </div>

                            <div className="absolute right-3 top-3 flex items-center gap-1">
                              {busy ? <Spinner className="size-3.5" /> : null}
                              <AutomationActionsMenu
                                automation={automation}
                                busy={busy}
                                canRestart={canRestart}
                                canToggle={canToggle}
                                onRunNow={handleRunNow}
                                onEdit={(target) => setView({ mode: "edit", automation: target })}
                                onToggle={handleToggle}
                                onRestart={handleRestart}
                                onDelete={handleDelete}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : (
                /* 空状态卡先于 Keep-awake，按钮组整体较卡片中心下移 8px。 */
                <div
                  data-automations-empty-state
                  className="flex h-[226px] w-full items-center justify-center rounded-2xl border border-card-border bg-background px-4"
                >
                  <div className="flex translate-y-2 flex-col items-center gap-5">
                    <p className="text-ui-base font-medium leading-5 text-foreground-subtlest">
                      {intl.formatMessage({ id: "automations.empty.title" })}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <AutomationCreateDropdown
                        onViaChat={handleCreateViaChat}
                        onManually={handleCreateManually}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 空态保持唤醒提示条位于大空卡之后。 */}
            {!hasAnyTasks ? (
              <AutomationKeepAwakeNotice
                checked={sharedSettings?.keepAwakeWhileRunning ?? false}
                onChange={(value) =>
                  void updateSharedSettings({
                    keepAwakeWhileRunning: value,
                  })
                }
              />
            ) : null}
          </div>

          {/* 真实任务卡与模板不能只靠空白分区：需要分割线；
             分割线使用 surface 在 Light 下过淡，因此与 Card 统一使用 card-border。
             外层 gap-8 加本容器 py-2，使卡片到线、线到模板标题均保持 40px。 */}
          {hasAnyTasks ? (
            <div
              data-automations-task-template-separator
              className="flex w-full flex-col py-2"
              aria-hidden="true"
            >
              <div className="h-px w-full bg-card-border" />
            </div>
          ) : null}

          <section
            data-automations-scheduled-templates
            aria-busy={automationTemplates.loading}
            className="flex w-full flex-col gap-4"
          >
            <h2 className="text-ui-base font-medium leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "automations.moreIdeas" })}
            </h2>
            {automationTemplates.loading ? (
              <AutomationTemplateSkeletonGrid
                label={intl.formatMessage({ id: "common.loading" })}
              />
            ) : automationTemplates.scheduled.length === 0 ? (
              <div
                data-automation-template-empty-state
                className="flex min-h-[114px] w-full items-center justify-center rounded-xl border border-card-border bg-background p-3 text-center text-ui-base font-normal text-foreground-subtlest"
              >
                {intl.formatMessage({ id: "automations.templates.unavailable" })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {automationTemplates.scheduled.map((template) => {
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => handleUseTemplate(template)}
                      className="group flex min-h-[114px] flex-col gap-2 overflow-hidden rounded-xl border border-card-border bg-background p-3 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused"
                    >
                      <div className="flex min-w-0 items-center gap-1 text-foreground">
                        <span className="flex size-5 shrink-0 items-center justify-center">
                          <AutomationScheduledTemplateIcon
                            iconName={template.iconName}
                            name={template.icon}
                          />
                        </span>
                        <span className="truncate text-ui-base font-medium leading-5 text-foreground">
                          {resolveAutomationTemplateText(template.title, locale)}
                        </span>
                      </div>
                      {/* 定时模板首次实现时把周期时间拼进标题行，应把周期信息放在独立的底部行。 */}
                      <p className="line-clamp-2 flex-1 text-ui-base font-normal leading-5 text-foreground-subtle">
                        {resolveAutomationTemplateText(template.description, locale)}
                      </p>
                      <div className="text-ui-base font-normal leading-5 text-foreground-subtle">
                        {describeAutomationCardSchedule({ cronExpr: template.cronExpr }, intl)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
