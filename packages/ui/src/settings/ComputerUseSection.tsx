/* eslint-disable max-lines -- CUA 设置页同时编排插件总开关、双权限状态与授权返回恢复链；后续单独拆分组件。 */
// 设置页「电脑控制 (Computer Use)」分区：
//  - 顶部一个总开关：开/关 zcode-cua 插件（连带其 MCP server 与 skill 一起启用/禁用）。
//  - macOS 下再展示 Accessibility / Screen Recording 两个权限行（含授权引导与 stale 恢复链）。
// UI 复用 SettingsGroupCard / SettingsRow / SettingsBadge / Switch，与其它设置分区保持一致。
//
// Helper 权限状态走 useCuaPermissionStatus：事件驱动（进入页面 / 窗口重获焦点 / 显式 refresh）
// 各查一次，不再定时轮询；状态存在共享缓存里，与输入框常驻入口读同一份。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettingService.js";
import type { CuaOsSupport, CuaPermissionKind, RemoteTarget } from "@zcode/shared";
import {
  DesktopCommandIds,
  isRemoteWorkspaceIdentity,
  ZCODE_CUA_OFFICIAL_PLUGIN_ID,
} from "@zcode/shared";
import { isCuaPermissionStatusAvailable } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { Switch } from "@/components/ui/switch.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useCuaPermissionStatus } from "@/hooks/useCuaPermissionStatus.js";
import { usePluginManagementStore } from "@/store/pluginManagementStore.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { StatusDot, type StatusDotTone } from "@/settings/StatusDot.js";
import { supportsLocalMacCuaPermissionOnboarding } from "@/lib/cuaPlatform.js";
import { runAfterSuccessfulPluginEnabledChange } from "@/settings/pluginEnabledChange.js";
import { ExternalLink } from "lucide-react";
import {
  isComputerUseRemoteOrLinux,
  resolveComputerUseAvailability,
} from "@/settings/computerUseAvailability.js";

interface ComputerUseSectionProps {
  isDesktop?: boolean;
  isMacDesktop?: boolean;
  isWindowsDesktop?: boolean;
  workspacePath?: string | null;
  workspaceIdentity?: string;
  remoteSessionId?: string | null;
  remoteTarget?: RemoteTarget | null;
  // SSH 远端设置页里 workspacePath 是远端路径；本机 Helper 状态查询必须使用本机 workspace 路径。
  localWorkspacePath?: string | null;
}

export function ComputerUseSection({
  isDesktop = false,
  isMacDesktop,
  isWindowsDesktop = false,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  remoteTarget,
  localWorkspacePath,
}: ComputerUseSectionProps) {
  const { intl } = useZCodeIntl();
  const services = useServices();
  const platform = usePlatform();
  const pluginManagementService = services.pluginManagementService;
  const isLocalWorkspace =
    !remoteSessionId &&
    !remoteTarget &&
    !(workspaceIdentity?.trim() && isRemoteWorkspaceIdentity(workspaceIdentity.trim()));
  // Windows 只复用插件总开关；macOS 才具备 TCC 权限、Helper 状态和附加设置能力。
  const supportsLocalMacWorkspace =
    !isWindowsDesktop &&
    (isMacDesktop ?? supportsLocalMacCuaPermissionOnboarding(platform)) &&
    isLocalWorkspace;
  const supportsLocalWindowsWorkspace = isWindowsDesktop && isLocalWorkspace;
  // Linux 桌面本机：无 TCC 权限卡，只复用插件总开关 + composer 入口。
  const supportsLocalLinuxWorkspace =
    isDesktop && isLocalWorkspace && !supportsLocalMacWorkspace && !supportsLocalWindowsWorkspace;
  const supportsComputerUseSettings =
    supportsLocalMacWorkspace || supportsLocalWindowsWorkspace || supportsLocalLinuxWorkspace;
  const availability = resolveComputerUseAvailability({
    isDesktop: isDesktop || isWindowsDesktop || supportsLocalMacWorkspace,
    isMacDesktop: isMacDesktop || supportsLocalMacWorkspace,
    isWindowsDesktop,
    remoteSessionId,
    remoteTarget,
    workspaceIdentity,
  });
  // CUA 权限是 macOS 本机属性：仅完整 macOS 设置需要 Helper workspace 路径。
  const path = supportsLocalMacWorkspace ? (localWorkspacePath ?? workspacePath) : null;
  // 展示只跟 settled：fresh 每次查询开始都会落回 false，跟着它渲染会让授权按钮的文案
  // 在「验证中…」与终态之间切换、宽度随之跳变。
  const { status, settled, refresh } = useCuaPermissionStatus(path ?? null, workspaceIdentity);
  const availableStatus = status && isCuaPermissionStatusAvailable(status) ? status : null;

  // macOS 版本门槛：低版本系统上 Helper 被 LaunchServices -10825 拒启，表象是授权反复无响应。
  // 查询一次主进程判定（GetCuaOsSupport），低于地板时渲染提示卡并隐藏授权操作区。
  // 查询失败按无门槛处理，不阻塞设置页；useCuaPermissionStatus 轮询保留，仅隐藏交互入口。
  const [osSupport, setOsSupport] = useState<CuaOsSupport | null>(null);
  useEffect(() => {
    if (!supportsLocalMacWorkspace || typeof platform.executeDesktopCommand !== "function") return;
    let cancelled = false;
    void platform
      .executeDesktopCommand(DesktopCommandIds.GetCuaOsSupport)
      .then((result) => {
        if (!cancelled) setOsSupport(result as CuaOsSupport);
      })
      .catch(() => {
        /* 查询失败按无门槛处理，不阻塞设置页 */
      });
    return () => {
      cancelled = true;
    };
  }, [supportsLocalMacWorkspace, platform]);

  const macOsBelowCuaFloor = osSupport?.kind === "macos-below-minimum";

  // 总开关 = zcode-cua 插件启用态（读自插件管理 store；切换即同步启用/禁用插件及其 MCP + skill）。
  const plugins = usePluginManagementStore((state) => state.plugins);
  const setPluginEnabled = usePluginManagementStore((state) => state.setEnabled);
  const initializePlugins = usePluginManagementStore((state) => state.initialize);
  const togglingPluginId = usePluginManagementStore((state) => state.togglingPluginId);
  const cuaPlugin = plugins.find((plugin) => plugin.id === ZCODE_CUA_OFFICIAL_PLUGIN_ID);
  const cuaEnabled = cuaPlugin?.enabled ?? false;
  const cuaToggling = togglingPluginId === ZCODE_CUA_OFFICIAL_PLUGIN_ID;

  const initRef = useRef(false);
  useEffect(() => {
    if (
      initRef.current ||
      !supportsComputerUseSettings ||
      !workspacePath ||
      !pluginManagementService
    )
      return;
    initRef.current = true;
    // 复用 Plugins 分区同一条初始化路径，确保 store 已加载 zcode-cua 的 enabled 态。
    void initializePlugins({
      workspacePath,
      workspaceIdentity,
      pluginService: pluginManagementService,
    });
  }, [
    supportsComputerUseSettings,
    workspacePath,
    workspaceIdentity,
    pluginManagementService,
    initializePlugins,
  ]);

  // 申请权限中的 in-flight 标记（按钮禁用 + 文案切换）。
  const [requesting, setRequesting] = useState(false);
  // 卸载守卫：异步申请 / 切换完成时若组件已卸载，跳过 setState。
  const mountedRef = useRef(true);
  const pluginToggleGenerationRef = useRef(0);
  const pluginToggleContextKey = [
    workspacePath ?? "",
    workspaceIdentity ?? "",
    localWorkspacePath ?? "",
    remoteSessionId ?? "",
    remoteTarget ? "remote" : "local",
  ].join("\u0000");
  const pluginToggleContextKeyRef = useRef(pluginToggleContextKey);
  pluginToggleContextKeyRef.current = pluginToggleContextKey;
  const platformRef = useRef(platform);
  platformRef.current = platform;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pluginToggleGenerationRef.current += 1;
    };
  }, []);

  // 申请 macOS TCC 授权。必须由 main 进程触发（平台能力 requestCuaPermissions），
  // 这样弹窗归属 ZCode.app 而不是 MCP worker；拿不到入口时 ok=false，只提示不伪造成功。
  const onRequestPermissions = useCallback(async (): Promise<void> => {
    if (typeof platform.requestCuaPermissions !== "function") return;
    setRequesting(true);
    try {
      const result = await platform.requestCuaPermissions();
      if (!result?.ok && mountedRef.current) {
        toast(
          intl.formatMessage(
            { id: "cuaPermission.modal.requestFailed" },
            { error: result?.reason ?? "unknown error" },
          ),
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        toast(
          intl.formatMessage(
            { id: "cuaPermission.modal.requestFailed" },
            { error: error instanceof Error ? error.message : String(error) },
          ),
        );
      }
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
    // 授权异步生效：申请后主动重查一次，让状态行尽快反映新授权。
    refresh();
  }, [platform, intl, refresh]);

  // 打开 macOS 系统设置面板，让用户自己勾选授权。打不开只提示，不抛。
  const onOpenSystemSettings = useCallback(async (): Promise<void> => {
    if (typeof platform.openCuaPermissionSystemSettings !== "function") return;
    try {
      const opened = await platform.openCuaPermissionSystemSettings();
      if (!opened && mountedRef.current) {
        toast(intl.formatMessage({ id: "cuaPermission.modal.unavailable" }));
      }
    } catch {
      if (mountedRef.current) {
        toast(intl.formatMessage({ id: "cuaPermission.modal.unavailable" }));
      }
    }
  }, [platform, intl]);


  const onTogglePlugin = useCallback(
    async (next: boolean) => {
      if (!pluginManagementService) return;
      const operationGeneration = ++pluginToggleGenerationRef.current;
      const operationContextKey = pluginToggleContextKey;
      // 切换 zcode-cua 插件 = 同步其 MCP server + skill 一起启用/禁用。
      const completed = await runAfterSuccessfulPluginEnabledChange({
        submit: () => setPluginEnabled(ZCODE_CUA_OFFICIAL_PLUGIN_ID, next, pluginManagementService),
        isCurrent: () =>
          mountedRef.current &&
          pluginToggleGenerationRef.current === operationGeneration &&
          pluginToggleContextKeyRef.current === operationContextKey,
        onSuccess: () => {
          if (supportsLocalMacWorkspace) {
            // 权限状态和手动授权入口只在 macOS Computer Use 设置页展示。启用插件不得自动打开
            // macOS Permissions modal；刷新状态即可，避免打断用户当前工作流。
            refresh();
          }
          if (!next) {
            toast(intl.formatMessage({ id: "settings.computerUse.disabledToast" }));
          }
        },
      });
      if (!completed && mountedRef.current) {
        const message = usePluginManagementStore.getState().error;
        if (message) {
          toast(message);
        }
      }
    },
    [
      path,
      pluginManagementService,
      pluginToggleContextKey,
      refresh,
      setPluginEnabled,
      supportsLocalMacWorkspace,
      intl,
    ],
  );

  // 打开 macOS 系统设置引导用户授权指定权限（Accessibility / Screen Recording）。
  // 权限状态 → { 圆点颜色 tone, 文案 text }，保证圆点与文案同源（granted 绿/stale 黄/denied 红/unknown 灰）。
  // TCC=granted 即稳定显示 granted（绿）；功能探针只用于 runtime 就绪判断，不再把显示态翻成 verifying。
  const statusView = (
    state: "granted" | "stale" | "denied" | "unknown" | undefined,
  ): { tone: StatusDotTone; text: string } => {
    if (state === "granted") {
      return {
        tone: "green",
        text: intl.formatMessage({ id: "cuaPermission.status.granted" }),
      };
    }
    if (state === "stale") {
      // stale 只表示状态需要重新确认；操作区统一给「申请权限 + 打开设置面板」，不再重启 Helper。
      return {
        tone: "amber",
        text: intl.formatMessage({ id: "cuaPermission.status.stale" }),
      };
    }
    if (state === "denied") {
      return {
        tone: "red",
        text: intl.formatMessage({ id: "cuaPermission.status.missing" }),
      };
    }
    return {
      tone: "muted",
      text: intl.formatMessage({ id: "cuaPermission.status.unknown" }),
    };
  };

  // 未授权 / 需重新确认时的操作区：主按钮向系统申请授权，次级链接打开对应设置面板
  // 让用户自己勾选。两者都由 main 进程经 cua-driver 触发，TCC 归属 ZCode.app。
  const renderGrantDetail = (labelId: string): ReactNode => {
    const canRequest = typeof platform.requestCuaPermissions === "function";
    const canOpenSettings = typeof platform.openCuaPermissionSystemSettings === "function";
    if (!canRequest && !canOpenSettings) return null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {canRequest ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={requesting || !settled}
            onClick={() => void onRequestPermissions()}
          >
            {requesting
              ? intl.formatMessage({ id: "cuaPermission.modal.requesting" })
              : intl.formatMessage({ id: "cuaPermission.modal.requestButton" })}
          </Button>
        ) : null}
        {canOpenSettings ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="text-sky-500 hover:text-sky-600 dark:text-sky-400 dark:hover:text-sky-300"
            aria-label={intl.formatMessage({ id: labelId })}
            title={intl.formatMessage({ id: labelId })}
            disabled={!settled}
            onClick={() => void onOpenSystemSettings()}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{intl.formatMessage({ id: labelId })}</span>
          </Button>
        ) : null}
      </div>
    );
  };


  const acc = statusView(availableStatus?.accessibility);
  const screenPerm = statusView(availableStatus?.screenRecording);

  // 输入框常驻入口的显隐。隐藏开关用 useSettings().update 写入
  // （直连 settingService 只落盘不刷新共享 snapshot，输入框按钮读不到新值）。
  // 乐观更新本地开关，失败回滚并提示。
  const { settings: appSettings, update: updateAppSettings } = useSettings();
  const [composerEntryHiddenOverride, setComposerEntryHiddenOverride] = useState<boolean | null>(
    null,
  );
  const [composerEntrySaving, setComposerEntrySaving] = useState(false);
  // 默认隐藏，与 useCuaComposerEntry 同口径：只有显式存过 false 才算展示。
  // 两处必须一致，否则设置页开关的显示状态会和输入框按钮的实际显隐对不上。
  const persistedComposerEntryHidden = appSettings?.computerUseComposerEntryHidden !== false;
  const composerEntryVisible = !(composerEntryHiddenOverride ?? persistedComposerEntryHidden);
  useEffect(() => {
    if (composerEntryHiddenOverride === null) return;
    if (persistedComposerEntryHidden === composerEntryHiddenOverride) {
      setComposerEntryHiddenOverride(null);
    }
  }, [composerEntryHiddenOverride, persistedComposerEntryHidden]);
  const onToggleComposerEntry = useCallback(
    async (visible: boolean) => {
      const nextHidden = !visible;
      setComposerEntryHiddenOverride(nextHidden);
      setComposerEntrySaving(true);
      try {
        await updateAppSettings({ computerUseComposerEntryHidden: nextHidden });
      } catch (error) {
        if (mountedRef.current) {
          setComposerEntryHiddenOverride(null);
          toast(
            intl.formatMessage(
              { id: "settings.computerUse.composerEntry.saveFailed" },
              { error: error instanceof Error ? error.message : String(error) },
            ),
          );
        }
      } finally {
        if (mountedRef.current) setComposerEntrySaving(false);
      }
    },
    [intl, updateAppSettings],
  );

  // 产品需求：denied（未授权）时右侧状态徽章本身可点击，
  // 效果同「打开系统设置」授权按钮；granted/stale/unknown 保持纯展示。
  const renderPermissionBadge = (
    kind: CuaPermissionKind,
    view: { tone: StatusDotTone; text: string },
    state: "granted" | "stale" | "denied" | "unknown" | undefined,
  ): ReactNode => {
    const clickable = state === "denied";
    const badge = (
      <SettingsBadge>
        <span className="inline-flex items-center gap-1.5">
          <StatusDot tone={view.tone} />
          {view.text}
        </span>
      </SettingsBadge>
    );
    if (!clickable) return badge;
    return (
      <button
        type="button"
        className="cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={view.text}
        onClick={() => void onOpenSystemSettings()}
      >
        {badge}
      </button>
    );
  };

  if (!supportsComputerUseSettings) {
    // 远端 / Linux 环境若直接 return null，设置页只剩标题，会让用户误以为页面加载失败。
    // 保留入口并明确能力边界，且不渲染任何会触发本地 CUA 写操作的控件。
    return (
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-ui-base text-warning">
        <p className="font-medium">
          {intl.formatMessage({ id: "settings.computerUse.unsupported.title" })}
        </p>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({
            id: isComputerUseRemoteOrLinux(availability)
              ? availability.kind === "local-linux"
                ? "settings.computerUse.unsupported.linuxDescription"
                : "settings.computerUse.unsupported.remoteDescription"
              : "settings.computerUse.unsupported.remoteDescription",
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 总开关：开/关 zcode-cua 插件（同步其 MCP + skill） */}
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.toggleLabel" })}
          description={intl.formatMessage({
            id: "settings.computerUse.toggleDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.computerUse.toggleLabel",
              })}
              checked={cuaEnabled}
              disabled={cuaToggling || !workspacePath}
              onCheckedChange={(checked) => void onTogglePlugin(checked)}
            />
          }
        />
        {/* 输入框常驻入口的显隐开关：关闭是持久化 hidden 标记，
            重启与版本更新都不会自愈。只管按钮渲不渲染，不影响插件启用态与进行中任务。
            电脑控制关闭时按钮无论如何都不渲染（cuaComposerEntryState 的插件门），
            此时把开关置灰并改文案说明前置条件——留一个可点却看不到效果的开关会被当成坏了。 */}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.computerUse.composerEntry.label" })}
          description={intl.formatMessage({
            id: cuaEnabled
              ? "settings.computerUse.composerEntry.description"
              : "settings.computerUse.composerEntry.requiresEnabled",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.computerUse.composerEntry.label",
              })}
              checked={composerEntryVisible}
              disabled={composerEntrySaving || !cuaEnabled}
              onCheckedChange={(checked) => void onToggleComposerEntry(checked)}
            />
          }
        />
      </SettingsGroupCard>

      {/* CUA 未启用时隐藏下方权限配置，只留总开关，避免一堆禁用项。 */}
      {cuaEnabled && supportsLocalMacWorkspace ? (
        <>
          {/* macOS 版本低于 CUA Helper 承诺地板时，授权在低版本系统上无法完成
              （Helper 被 LaunchServices -10825 拒启），整卡替换为升级提示。 */}
          {macOsBelowCuaFloor ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              <p className="font-medium">
                {intl.formatMessage(
                  { id: "cuaPermission.osFloorTitle" },
                  {
                    minimum: osSupport?.minimumMacOs ?? "12.0",
                    current: osSupport?.currentMacOs ?? "12 以下",
                  },
                )}
              </p>
              <p>{intl.formatMessage({ id: "cuaPermission.osFloorDescription" })}</p>
            </div>
          ) : null}
          {/* macOS 权限引导只保留在 Settings 内，CUA 操作与工具审批流不再自动弹权限 modal。 */}
          {!macOsBelowCuaFloor ? (
            <SettingsGroupCard>
              <SettingsRow
                controlLayout="wide"
                label={intl.formatMessage({
                  id: "cuaPermission.perm.accessibility",
                })}
                description={intl.formatMessage({
                  id: "cuaPermission.perm.accessibility.purpose",
                })}
                control={renderPermissionBadge(
                  "accessibility",
                  acc,
                  availableStatus?.accessibility,
                )}
                detail={
                  availableStatus?.accessibility === "granted"
                    ? undefined
                    : renderGrantDetail("chat.cuaPermission.openAccessibility")
                }
              />
              <SettingsRow
                controlLayout="wide"
                label={intl.formatMessage({
                  id: "cuaPermission.perm.screenRecording",
                })}
                description={intl.formatMessage({
                  id: "cuaPermission.perm.screenRecording.purpose",
                })}
                control={renderPermissionBadge(
                  "screen_recording",
                  screenPerm,
                  availableStatus?.screenRecording,
                )}
                detail={
                  availableStatus?.screenRecording === "granted"
                    ? undefined
                    : renderGrantDetail("chat.cuaPermission.openScreenRecording")
                }
              />
            </SettingsGroupCard>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
