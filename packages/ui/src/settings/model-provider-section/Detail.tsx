/* eslint-disable max-lines -- Model Provider 详情页当前集中编排 Plan Card、API Key 表单和 OAuth 套餐态；后续稳定后再按 family/API/OAuth 拆分。 */
import {
  BIGMODEL_PROVIDER_ID,
  ZAI_PROVIDER_ID,
  type BuiltinModelProviderId,
  type ProviderFamilyConnectionSelectionSettings,
  isStartPlanModelProviderId,
  isIndividualCodingPlanModelProviderId,
  resolveModelProviderFamilySpecByProviderId,
  type ModelConnectivityResult,
  type OAuthProviderId,
} from "@zcode/shared";
import {
  getProviderFormApiKeyManagementUrl,
  type ProviderSettingsFormProvider,
} from "@/lib/providerSettingsFormTypes.js";
import { useEffect, useMemo } from "react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { type CodingPlanStatus, type ModelProviderNavItem } from "./constants.js";
import { InlineEditableProviderCard } from "./InlineEditableProviderCard.js";
import {
  ModelProviderLoadingCard,
  PresetProviderPlaceholderCard,
  CodingPlanStatusPanel,
} from "./StatusCards.js";
import { type CodingPlanLoginOptions } from "./codingPlanPricingCards.js";
import { resolveCodingPlanStatusPanelViewState } from "./codingPlanStatusPanelViewState.js";
import {
  ProviderFamilyDetailShell,
  ProviderFamilyHeader,
  ProviderFamilyPlanModeSwitch,
} from "./ProviderFamilyModeHeader.js";
import { useUsageEntitlement } from "@/hooks/useUsageEntitlement.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import type { ProviderModelCatalogResult, ProviderSettingsView } from "@zcode/services";
import type { SavePersonalModelDraftInput } from "@zcode/provider";
import { resolveAccountProviderInspectionAccess } from "@/lib/accountProviderAccess.js";
import { projectProviderSettingsViewToFormProviders } from "@/lib/providerSettingsFormProjection.js";

function isPlanNavItem(
  item: ModelProviderNavItem | null,
): item is Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }> {
  return item?.type === "codingPlan" || item?.type === "teamPlan";
}

function hasTeamPlanContext(item: ModelProviderNavItem | null): item is Extract<
  ModelProviderNavItem,
  { type: "teamPlan" }
> & {
  organizationId: string;
  projectId: string;
} {
  return (
    item?.type === "teamPlan" &&
    (item.organizationId?.trim().length ?? 0) > 0 &&
    (item.projectId?.trim().length ?? 0) > 0
  );
}

function resolveTeamScopedPlanNavItem(
  item: Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }>,
  entitlement: ReturnType<typeof useUsageEntitlement>,
): Extract<ModelProviderNavItem, { type: "codingPlan" | "teamPlan" }> {
  if (item.type !== "teamPlan" || !hasTeamPlanContext(item)) {
    return item;
  }
  if (
    item.availabilityReason === "credential-unavailable" &&
    entitlement.snapshot?.unavailableReason !== "no_plan"
  ) {
    // 已知 Project Key 不可用时，后续 quota loading/error 不能把真实原因改写成
    // “正在检查”或“团队套餐未分配”。Provider 配置仍由 Settings View 独立展示。
    return {
      ...item,
      status: "unavailable" as const,
      statusLabelId: undefined,
      statusActive: false,
      quotaLimits: [],
    };
  }
  const snapshot = entitlement.snapshot;
  if (!snapshot) {
    if (entitlement.loading) {
      return {
        ...item,
        // Team Plan 额度按组织 / 项目重新查询，切换团队时不能继续展示上一团队额度。
        status: "checking" as const,
        statusLabelId: undefined,
        availabilityReason: undefined,
        statusActive: false,
        quotaLimits: [],
      };
    }
    if (entitlement.error) {
      return {
        ...item,
        // 请求失败只证明权益状态未知，不能等价成服务端明确判定“团队套餐未分配”。
        status: "unavailable" as const,
        statusLabelId: undefined,
        availabilityReason: undefined,
        statusActive: false,
        quotaLimits: [],
      };
    }
    return item;
  }
  if (entitlement.loading && !snapshot.subscription) {
    return {
      ...item,
      status: "checking" as const,
      statusLabelId: undefined,
      availabilityReason: undefined,
      statusActive: false,
      quotaLimits: [],
    };
  }
  if (entitlement.error && !snapshot.subscription) {
    return {
      ...item,
      status: "unavailable" as const,
      statusLabelId: undefined,
      availabilityReason: undefined,
      statusActive: false,
      quotaLimits: [],
    };
  }
  const hasTeamSubscription = Boolean(snapshot.subscription?.details.length);
  const noPlan = snapshot.unavailableReason === "no_plan";
  const expired = noPlan && snapshot.teamPlanUnavailableReason === "expired";
  return {
    ...item,
    // 权益只来自团队订阅查询；quota 查询失败不能撤销订阅，也不能被解释成未分配。
    status: hasTeamSubscription ? ("purchased" as const) : ("unavailable" as const),
    planLevel: item.teamPlanName?.trim() || item.planLevel,
    currentProductId: item.currentProductId,
    subscriptionBillingCycle: null,
    subscriptionRenewTime: null,
    subscriptionExpireTime: null,
    subscriptionDetails: [],
    quotaLimits: snapshot.quota?.limits ?? [],
    statusLabelId:
      !hasTeamSubscription && noPlan
        ? expired
          ? "settings.modelProvider.codingPlan.status.teamExpired"
          : "settings.modelProvider.codingPlan.status.teamUnavailable"
        : undefined,
    statusMessage: noPlan ? undefined : item.statusMessage,
    availabilityReason:
      !hasTeamSubscription && noPlan ? (expired ? "expired" : "not-allocated") : undefined,
    statusActive: hasTeamSubscription,
  };
}

function resolveTeamPlanInspectionAccess(
  item: Extract<ModelProviderNavItem, { type: "teamPlan" }>,
) {
  // 不可用套餐仍需查询失效原因；组织/项目身份来自团队导航，不能被执行可用性门禁清空。
  const family = resolveModelProviderFamilySpecByProviderId(item.presetId)?.id;
  const productId = item.currentProductId?.trim();
  const organizationId = item.organizationId?.trim();
  const projectId = item.projectId?.trim();
  if (!family || !productId || !organizationId || !projectId) return undefined;
  return {
    type: "zhipu-account" as const,
    family,
    planKind: "team-coding-plan" as const,
    productId,
    organizationId,
    projectId,
  };
}

function resolvePlanSettingsProvider({
  view,
  providerId,
  fallback,
}: {
  view: ProviderSettingsView | null | undefined;
  providerId: string;
  fallback: ProviderSettingsFormProvider | null;
}): ProviderSettingsFormProvider | null {
  if (view) {
    return (
      projectProviderSettingsViewToFormProviders(view).find(
        (provider) => provider.providerId === providerId,
      ) ?? null
    );
  }
  return fallback?.providerId === providerId ? fallback : null;
}

export function ModelProviderSectionDetail({
  selectedNavItem,
  navigationItems = selectedNavItem ? [selectedNavItem] : [],
  connectionSettingsFailed = false,
  connectionSelections,
  startPlanSubscriptionCount = 0,
  presetLoading,
  codingPlanAuthError,
  presetSubscriptionProviderId,
  codingPlanStatusSyncProviderId,
  codingPlanDisconnectProviderId,
  onSave,
  onAddPersonalModel,
  onSavePersonalModelDraft,
  onSetPersonalModelEnabled,
  onDeletePersonalModel,
  onDelete,
  onReorderProviderModels,
  onTestModel,
  onFetchModels,
  onCodingPlanLogin,
  onRetryCodingPlan,
  onCodingPlanDisconnect,
  onOpenApiKeyUrl,
  onOpenBigModelRegistration,
  onRefreshEntitlements,
  onSelectNavItem,
  providerSettingsView: providerSettingsViewOverride,
}: {
  selectedNavItem: ModelProviderNavItem | null;
  navigationItems?: ModelProviderNavItem[];
  connectionSettingsFailed?: boolean;
  connectionSelections?: ProviderFamilyConnectionSelectionSettings;
  startPlanSubscriptionCount?: number;
  presetLoading: boolean;
  codingPlanAuthError?: string | null;
  presetSubscriptionProviderId: BuiltinModelProviderId | null;
  codingPlanStatusSyncProviderId: BuiltinModelProviderId | null;
  codingPlanDisconnectProviderId: BuiltinModelProviderId | null;
  onSave: (config: ProviderSettingsFormProvider) => void | Promise<void>;
  onAddPersonalModel?: (
    providerId: string,
    modelId: string,
    config: ProviderSettingsFormProvider["models"][number]["personalConfig"],
    useRecommendedConfig?: boolean,
  ) => Promise<unknown>;
  onSavePersonalModelDraft?: (input: SavePersonalModelDraftInput) => Promise<unknown>;
  onSetPersonalModelEnabled?: (
    providerId: string,
    modelId: string,
    enabled: boolean,
  ) => Promise<unknown>;
  onDeletePersonalModel?: (providerId: string, modelId: string) => Promise<unknown>;
  onDelete: (provider: ProviderSettingsFormProvider) => Promise<void>;
  onReorderProviderModels?: (providerId: string, modelIds: string[]) => Promise<void>;
  onTestModel: (providerId: string, modelId: string) => Promise<ModelConnectivityResult>;
  /** 自定义 API Key Provider 的模型目录读取；未装配时卡片不显示该入口。 */
  onFetchModels?: (providerId: string) => Promise<ProviderModelCatalogResult>;
  onRetryCodingPlan?: () => void | Promise<void>;
  onCodingPlanLogin: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
    status: CodingPlanStatus,
    options?: CodingPlanLoginOptions,
  ) => number | void;
  onCodingPlanDisconnect: (
    presetId: BuiltinModelProviderId,
    providerId: OAuthProviderId,
    providerName: string,
  ) => void;
  onOpenApiKeyUrl: (url: string) => void;
  onOpenBigModelRegistration: () => void;
  onRefreshEntitlements: () => void | Promise<void>;
  onSelectNavItem?: (item: ModelProviderNavItem) => void;
  providerSettingsView?: ProviderSettingsView | null;
}) {
  const { intl } = useZCodeIntl();
  const loadingLabel = intl.formatMessage({ id: "common.loading" });
  const rootProviderSettingsRead = useProviderSettingsView();
  const rootProviderSettingsView =
    rootProviderSettingsRead.state.status === "ready" ? rootProviderSettingsRead.state.view : null;
  const providerSettingsView = providerSettingsViewOverride ?? rootProviderSettingsView;
  // 账号分支曾漏传删除回调，出现只删 UI 不写盘。所有详情共用同一套模型操作装配。
  const modelEditingProps = {
    onAddPersonalModel,
    onSavePersonalModelDraft,
    onSetPersonalModelEnabled,
    onDeletePersonalModel,
    onFetchModels,
    settingsRevision: providerSettingsView?.revision,
  };
  const selectedPlanAccess = useMemo(() => {
    if (!isPlanNavItem(selectedNavItem)) return undefined;
    if (selectedNavItem.type === "teamPlan")
      return resolveTeamPlanInspectionAccess(selectedNavItem);
    const access = resolveAccountProviderInspectionAccess(
      providerSettingsView,
      selectedNavItem.presetId,
    );
    if (
      !access ||
      (access.access.mode !== "start-plan" && access.access.mode !== "individual-coding-plan")
    )
      return undefined;
    return {
      type: "zhipu-account" as const,
      family: access.access.accountType,
      planKind: access.access.mode,
    };
  }, [providerSettingsView, selectedNavItem]);
  const selectedTeamPlanContext = useMemo(
    () =>
      hasTeamPlanContext(selectedNavItem)
        ? {
            organizationId: selectedNavItem.organizationId.trim(),
            projectId: selectedNavItem.projectId.trim(),
          }
        : null,
    [selectedNavItem],
  );
  const selectedTeamPlanEntitlement = useUsageEntitlement({
    enabled: Boolean(selectedTeamPlanContext),
    includeSubscription: true,
    preferredProviderId:
      selectedNavItem?.type === "teamPlan" ? selectedNavItem.presetId : undefined,
    accountAccess: selectedPlanAccess,
    // 已购 Team Plan 时，个人 Coding Plan provider 可能因个人权益不可用被标记 disabled。
    // Team 额度查询仍复用 Coding Plan quota 链路，并追加组织 / 项目上下文，不能在服务选择阶段被过滤。
    allowDisabledPreferredProvider: selectedNavItem?.type === "teamPlan",
    requirePreferredProvider: true,
    allowEnvApiKey: false,
    cacheKey: selectedNavItem?.key ?? undefined,
    refreshOnMount: false,
  });
  useEffect(() => {
    if (!selectedTeamPlanContext) {
      return;
    }
    void selectedTeamPlanEntitlement.refresh({
      silent: true,
      reason: "access",
    });
  }, [selectedTeamPlanContext, selectedTeamPlanEntitlement.refresh]);
  const effectiveSelectedPlanNavItem = isPlanNavItem(selectedNavItem)
    ? resolveTeamScopedPlanNavItem(selectedNavItem, selectedTeamPlanEntitlement)
    : null;
  const planModeSwitch = (
    <ProviderFamilyPlanModeSwitch
      selectedNavItem={selectedNavItem}
      navigationItems={navigationItems}
      connectionSettingsFailed={connectionSettingsFailed}
      connectionSelections={connectionSelections}
      startPlanSubscriptionCount={startPlanSubscriptionCount}
      onSelectNavItem={onSelectNavItem}
    />
  );

  if (!selectedNavItem) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  if (selectedNavItem.type === "preset") {
    if (!selectedNavItem.provider) {
      // 首屏慢网时预置供应商配置尚未返回，之前这里会直接展示“尚未同步，请先完成 OAuth 登录”，
      // 用户会把“还在下载”误判成“当前账号未登录”。首刷期间改为明确显示 loading，等请求结束后再决定是否展示未同步占位。
      if (presetLoading) {
        return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
      }

      return <PresetProviderPlaceholderCard displayName={selectedNavItem.displayName} />;
    }

    const presetProvider = selectedNavItem.provider;

    const familySpec = resolveModelProviderFamilySpecByProviderId(selectedNavItem.presetId);
    const presetFamilyHeader = (
      <ProviderFamilyHeader
        selectedNavItem={selectedNavItem}
        trailingAction={familySpec ? planModeSwitch : undefined}
      />
    );
    return (
      <ProviderFamilyDetailShell header={presetFamilyHeader}>
        <InlineEditableProviderCard
          provider={presetProvider}
          onSave={onSave}
          {...modelEditingProps}
          onReorderModelIds={
            onReorderProviderModels
              ? (modelIds) => onReorderProviderModels(presetProvider.providerId, modelIds)
              : undefined
          }
          onTestModel={onTestModel}
          readOnlyEndpoints
          // 预置供应商名称承载固定 API Key 入口语义，
          // 允许重命名会让侧边栏和模型选择器展示含义不一致，因此只允许自定义供应商改名。
          nameEditable={false}
          headerVisible={!familySpec}
          headerActionsVisible={familySpec ? false : undefined}
        />
      </ProviderFamilyDetailShell>
    );
  }

  if (effectiveSelectedPlanNavItem) {
    const selectedNavItem = effectiveSelectedPlanNavItem;
    const dedicatedProvider = resolvePlanSettingsProvider({
      view: providerSettingsView,
      providerId: selectedNavItem.presetId,
      fallback: selectedNavItem.provider,
    });
    const codingPlanLoginPending = presetSubscriptionProviderId === selectedNavItem.presetId;
    const codingPlanStatusSyncPending = codingPlanStatusSyncProviderId === selectedNavItem.presetId;
    const codingPlanDisconnectPending = codingPlanDisconnectProviderId === selectedNavItem.presetId;
    const hasResolvedEntitlementStatus =
      selectedNavItem.status === "purchased" || selectedNavItem.status === "notPurchased";
    const statusPanelViewState =
      codingPlanDisconnectPending || (codingPlanStatusSyncPending && !hasResolvedEntitlementStatus)
        ? {
            // 登录/登出后的 provider key 与权益刷新是异步链路。
            // 刷新落定前继续展示旧的未连接/已连接状态会让用户误以为操作失败。
            displayStatus: "checking" as const,
            actionStatus: "checking" as const,
            balanceStatus: "checking" as const,
            loginLoading: codingPlanStatusSyncPending,
          }
        : resolveCodingPlanStatusPanelViewState({
            status: selectedNavItem.status,
            loginPending: codingPlanLoginPending || codingPlanStatusSyncPending,
          });
    const visibleStatusLabelId =
      statusPanelViewState.displayStatus === "checking" ? undefined : selectedNavItem.statusLabelId;
    const isStartPlanProvider = isStartPlanModelProviderId(selectedNavItem.presetId);
    // 明确无权益时隐藏配置入口，但查询/取 Key 失败不能推断无权益，也不删除配置。
    const hasNoPlanEntitlement =
      !isStartPlanProvider &&
      (selectedNavItem.type === "teamPlan"
        ? selectedNavItem.availabilityReason === "not-allocated" ||
          selectedNavItem.availabilityReason === "expired"
        : selectedNavItem.status === "notPurchased");
    // Start 已由 Account 快照确认可用时，额度查询清空/刷新自己的缓存不能卸载编辑器。
    // 未取得套餐时不展示可执行模型；配置区不依赖额度请求的临时 loading 状态。
    const accountAvailable =
      providerSettingsView?.providers.find(
        (provider) => provider.providerId === selectedNavItem.presetId,
      )?.accountState?.availability === "available";
    const hidePlanModels =
      hasNoPlanEntitlement ||
      selectedNavItem.status === "disconnected" ||
      selectedNavItem.status === "notPurchased";
    const shouldShowDedicatedProviderDetail =
      dedicatedProvider !== null &&
      !hidePlanModels &&
      (!isStartPlanProvider || accountAvailable || selectedNavItem.status === "purchased");
    const reloginOnFailure =
      selectedNavItem.type === "codingPlan" &&
      isIndividualCodingPlanModelProviderId(selectedNavItem.presetId) &&
      selectedNavItem.provider?.accountState?.unavailableReason === "credential-failed";
    // 团队查询/取 Key 失败不是未登录：先刷新 Host 凭据，再刷新当前团队权益。
    const retryTeamPlan =
      selectedNavItem.type === "teamPlan" &&
      selectedNavItem.status === "unavailable" &&
      selectedNavItem.availabilityReason !== "not-allocated" &&
      selectedNavItem.availabilityReason !== "expired" &&
      onRetryCodingPlan
        ? async () => {
            await onRetryCodingPlan();
            await selectedTeamPlanEntitlement.refresh({ force: true, reason: "manual" });
          }
        : undefined;
    const accessBanner =
      isStartPlanProvider ||
      (selectedNavItem.type === "teamPlan" &&
        (selectedNavItem.availabilityReason === "not-allocated" ||
          selectedNavItem.availabilityReason === "expired"))
        ? null
        : resolveCodingPlanAccessBanner(statusPanelViewState.displayStatus, intl, reloginOnFailure);
    const codingPlanFamilyHeader = (
      <ProviderFamilyHeader selectedNavItem={selectedNavItem} trailingAction={planModeSwitch} />
    );
    const planSupplementalContent = accessBanner ? (
      <CodingPlanAccessBanner title={accessBanner.title} description={accessBanner.description} />
    ) : null;

    if (shouldShowDedicatedProviderDetail && dedicatedProvider) {
      const statusPanel = (
        <CodingPlanStatusPanel
          providerId={selectedNavItem.presetId}
          providerName={selectedNavItem.providerName}
          status={selectedNavItem.status}
          viewState={statusPanelViewState}
          planLevel={selectedNavItem.planLevel}
          subscriptionRenewTime={selectedNavItem.subscriptionRenewTime}
          subscriptionExpireTime={selectedNavItem.subscriptionExpireTime}
          subscriptionDetails={selectedNavItem.subscriptionDetails}
          quotaLimits={selectedNavItem.quotaLimits}
          mcpQuotaLimit={selectedNavItem.mcpQuotaLimit ?? null}
          authError={codingPlanAuthError}
          onOpenRegistration={onOpenBigModelRegistration}
          inactivePlanTitle={selectedNavItem.inactivePlanTitle}
          statusLabelId={visibleStatusLabelId}
          statusMessage={selectedNavItem.statusMessage}
          teamPlanAvailabilityReason={
            selectedNavItem.type === "teamPlan" ? selectedNavItem.availabilityReason : undefined
          }
          quotaResetSourceKey={
            selectedNavItem.type === "teamPlan" ? selectedNavItem.key : selectedNavItem.presetId
          }
          quotaResetAccountAccess={selectedPlanAccess}
          onQuotaResetEntitlementRefresh={
            selectedNavItem.type === "teamPlan"
              ? () =>
                  selectedTeamPlanEntitlement.refresh({
                    force: true,
                    reason: "manual",
                  })
              : onRefreshEntitlements
          }
          onDisconnect={
            (selectedNavItem.oauthProviderId === BIGMODEL_PROVIDER_ID ||
              selectedNavItem.oauthProviderId === ZAI_PROVIDER_ID) &&
            dedicatedProvider.providerId === selectedNavItem.presetId
              ? () => {
                  onCodingPlanDisconnect(
                    selectedNavItem.presetId,
                    selectedNavItem.oauthProviderId,
                    selectedNavItem.providerName,
                  );
                }
              : undefined
          }
          disconnectLoading={codingPlanDisconnectProviderId === selectedNavItem.presetId}
          // Plan Card 在未登录/登录失效时仍然是用户当前选中的入口。
          // 之前详情页没有打开状态卡内置登录动作，导致用户能进入 Coding tab 却只能看到“未连接”文案。
          loginActionVisible
          loginActionPlacement="trailing"
          reloginOnFailure={reloginOnFailure}
          onRetry={
            retryTeamPlan ??
            (selectedNavItem.type === "codingPlan" &&
            !selectedNavItem.accountLoginRequired &&
            (selectedNavItem.status === "unavailable" ||
              selectedNavItem.statusLabelId ===
                "settings.modelProvider.codingPlan.status.unavailable" ||
              (isIndividualCodingPlanModelProviderId(selectedNavItem.presetId) &&
                selectedNavItem.provider?.accountState?.unavailableReason === "credential-failed"))
              ? onRetryCodingPlan
              : undefined)
          }
          onLogin={(options) => {
            return onCodingPlanLogin(
              selectedNavItem.presetId,
              selectedNavItem.oauthProviderId,
              selectedNavItem.providerName,
              // 查看套餐接口要求业务 OAuth 仍有效；已购买状态下的“重新链接”不能只静默刷新 key，
              // 否则 OAuth 过期时点击没有可见反馈。升级态的重连强制走重新登录路径。
              selectedNavItem.status,
              options,
            );
          }}
        />
      );

      return (
        <ProviderFamilyDetailShell header={codingPlanFamilyHeader}>
          <InlineEditableProviderCard
            provider={dedicatedProvider}
            onSave={onSave}
            {...modelEditingProps}
            onReorderModelIds={
              onReorderProviderModels
                ? (modelIds) => onReorderProviderModels(dedicatedProvider.providerId, modelIds)
                : undefined
            }
            onTestModel={onTestModel}
            nameEditable={false}
            statusSection={
              <div className="space-y-3">
                {statusPanel}
                {planSupplementalContent}
              </div>
            }
            headerActionsVisible={false}
          />
        </ProviderFamilyDetailShell>
      );
    }

    return (
      <ProviderFamilyDetailShell header={codingPlanFamilyHeader}>
        <div className="space-y-3">
          <CodingPlanStatusPanel
            providerId={selectedNavItem.presetId}
            providerName={selectedNavItem.providerName}
            status={selectedNavItem.status}
            viewState={statusPanelViewState}
            // 未登录状态下右侧只渲染 Plan Card，不再回退到 API Key 表单。
            // 因此登录入口必须留在 Plan Card 本身，否则用户进入 Coding tab 后没有下一步动作。
            loginActionVisible
            loginActionPlacement="trailing"
            planLevel={selectedNavItem.planLevel}
            inactivePlanTitle={selectedNavItem.inactivePlanTitle}
            statusLabelId={visibleStatusLabelId}
            statusMessage={selectedNavItem.statusMessage}
            teamPlanAvailabilityReason={
              selectedNavItem.type === "teamPlan" ? selectedNavItem.availabilityReason : undefined
            }
            quotaResetSourceKey={
              selectedNavItem.type === "teamPlan" ? selectedNavItem.key : selectedNavItem.presetId
            }
            quotaResetAccountAccess={selectedPlanAccess}
            onQuotaResetEntitlementRefresh={
              selectedNavItem.type === "teamPlan"
                ? () =>
                    selectedTeamPlanEntitlement.refresh({
                      force: true,
                      reason: "manual",
                    })
                : onRefreshEntitlements
            }
            subscriptionRenewTime={selectedNavItem.subscriptionRenewTime}
            subscriptionExpireTime={selectedNavItem.subscriptionExpireTime}
            subscriptionDetails={selectedNavItem.subscriptionDetails}
            quotaLimits={selectedNavItem.quotaLimits}
            mcpQuotaLimit={selectedNavItem.mcpQuotaLimit ?? null}
            authError={codingPlanAuthError}
            onOpenRegistration={onOpenBigModelRegistration}
            onLogin={(options) => {
              return onCodingPlanLogin(
                selectedNavItem.presetId,
                selectedNavItem.oauthProviderId,
                selectedNavItem.providerName,
                selectedNavItem.status,
                options,
              );
            }}
            reloginOnFailure={reloginOnFailure}
            onRetry={
              retryTeamPlan ??
              (selectedNavItem.type === "codingPlan" &&
              !selectedNavItem.accountLoginRequired &&
              (selectedNavItem.status === "unavailable" ||
                selectedNavItem.statusLabelId ===
                  "settings.modelProvider.codingPlan.status.unavailable" ||
                (isIndividualCodingPlanModelProviderId(selectedNavItem.presetId) &&
                  selectedNavItem.provider?.accountState?.unavailableReason ===
                    "credential-failed"))
                ? onRetryCodingPlan
                : undefined)
            }
            onDisconnect={
              (selectedNavItem.oauthProviderId === BIGMODEL_PROVIDER_ID ||
                selectedNavItem.oauthProviderId === ZAI_PROVIDER_ID) &&
              selectedNavItem.provider?.providerId === selectedNavItem.presetId &&
              selectedNavItem.status !== "disconnected"
                ? () => {
                    onCodingPlanDisconnect(
                      selectedNavItem.presetId,
                      selectedNavItem.oauthProviderId,
                      selectedNavItem.providerName,
                    );
                  }
                : undefined
            }
            disconnectLoading={codingPlanDisconnectProviderId === selectedNavItem.presetId}
          />
          {hidePlanModels ? null : providerSettingsView && !dedicatedProvider ? (
            <PresetProviderPlaceholderCard
              displayName={selectedNavItem.providerName}
              messageId="settings.modelProvider.accountProviderConfigMissing"
            />
          ) : !selectedNavItem.provider ||
            selectedNavItem.provider.providerId !== selectedNavItem.presetId ? (
            <ModelProviderLoadingCard loadingLabel={loadingLabel} />
          ) : null}
          {planSupplementalContent}
        </div>
      </ProviderFamilyDetailShell>
    );
  }

  if (selectedNavItem.type === "codingPlanLoading") {
    // Z.AI plan 判定占位只属于左侧导航，不应进入详情表单渲染路径。
    return null;
  }

  if (!selectedNavItem.provider) {
    return <ModelProviderLoadingCard loadingLabel={loadingLabel} />;
  }

  const customProvider = selectedNavItem.provider;
  const customApiKeyUrl = customProvider.templateId
    ? getProviderFormApiKeyManagementUrl(customProvider)
    : undefined;
  return (
    // 仅展示预设模板声明的入口，不根据地址猜测自定义 Provider 的 Key 控制台。
    <InlineEditableProviderCard
      provider={customProvider}
      onSave={onSave}
      {...modelEditingProps}
      onDelete={() => onDelete(customProvider)}
      onReorderModelIds={
        onReorderProviderModels
          ? (modelIds) => onReorderProviderModels(customProvider.providerId, modelIds)
          : undefined
      }
      onTestModel={onTestModel}
      onFetchModels={onFetchModels}
      presetApiKeyUrl={customApiKeyUrl}
      readOnlyEndpoints={false}
      nameEditable
      onOpenPresetApiKey={
        customApiKeyUrl
          ? () => {
              onOpenApiKeyUrl(customApiKeyUrl);
            }
          : undefined
      }
    />
  );
}

function CodingPlanAccessBanner({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-ui-base font-medium text-foreground">{title}</div>
      <p className="mt-1 text-ui-sm leading-6 text-foreground-subtle">{description}</p>
    </div>
  );
}

function resolveCodingPlanAccessBanner(
  status: CodingPlanStatus,
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  reloginOnFailure = false,
): { title: string; description: string } | null {
  if (
    status !== "disconnected" &&
    status !== "notPurchased" &&
    !(status === "unavailable" && reloginOnFailure)
  ) {
    return null;
  }
  return {
    title: intl.formatMessage({
      id: `settings.modelProvider.codingPlan.status.${status}`,
    }),
    description: intl.formatMessage({
      id:
        status === "unavailable" && reloginOnFailure
          ? "settings.modelProvider.codingPlan.description.credentialFailed"
          : `settings.modelProvider.codingPlan.description.${status}`,
    }),
  };
}
