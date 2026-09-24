import { useEffect } from "react";
import type { CuaPermissionKind, CuaPermissionRequestResult } from "@zcode/shared";
import { requiredCuaPermissionsForRequestAccessStatus } from "@zcode/shared/zcode-protocol-v4";
import {
  isCuaPermissionStatusAvailable,
  type CuaPermissionStatusResult,
  type ZCodeAgentCuaPermissionObservation,
} from "@zcode/services";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { fetchCuaPermissionStatus } from "@/lib/cuaPermissionStatusStore.js";
import { logger } from "@/logger.js";
import { requiredCuaPermissionsForFreshStatus } from "@/settings/cuaPermissionPreparation.js";

interface CuaPermissionPromptDependencies {
  getStatus(): Promise<CuaPermissionStatusResult>;
  confirm(required: CuaPermissionKind[]): Promise<boolean>;
  requestPermissions(): Promise<CuaPermissionRequestResult | undefined>;
  openSystemSettings(): Promise<boolean>;
  refresh(): void;
  isDisposed?(): boolean;
}

const CUA_PERMISSION_RETRY_DELAY_MS = 500;

function assertCuaPermissionPromptActive(dependencies: CuaPermissionPromptDependencies): void {
  if (dependencies.isDisposed?.()) throw new Error("CUA permission prompt disposed");
}

async function runWithOneRetry<T>(
  dependencies: CuaPermissionPromptDependencies,
  operation: () => Promise<T>,
  failureReason?: (result: T) => string | undefined,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    assertCuaPermissionPromptActive(dependencies);
    try {
      const result = await operation();
      assertCuaPermissionPromptActive(dependencies);
      const reason = failureReason?.(result);
      if (reason) throw new Error(reason);
      return result;
    } catch (error) {
      if (attempt === 1 || dependencies.isDisposed?.()) throw error;
      await new Promise((resolve) => setTimeout(resolve, CUA_PERMISSION_RETRY_DELAY_MS));
    }
  }
  throw new Error("CUA permission retry exhausted");
}

function cuaPermissionObservationKey(observation: ZCodeAgentCuaPermissionObservation): string {
  const workspaceKey = observation.workspaceIdentity?.trim() || observation.workspacePath;
  const missing = requiredCuaPermissionsForRequestAccessStatus(observation.permissionStatus);
  return [
    workspaceKey,
    observation.sessionId,
    observation.turnId ?? observation.eventId,
    missing.join(","),
  ].join("\0");
}

async function runCuaPermissionPrompt(
  dependencies: CuaPermissionPromptDependencies,
): Promise<void> {
  const readMissing = async () => {
    const status = await runWithOneRetry(dependencies, dependencies.getStatus);
    return isCuaPermissionStatusAvailable(status)
      ? requiredCuaPermissionsForFreshStatus(status)
      : [];
  };
  const beforeConfirm = await readMissing();
  if (beforeConfirm.length === 0) return;
  assertCuaPermissionPromptActive(dependencies);
  if (!(await dependencies.confirm(beforeConfirm))) return;
  assertCuaPermissionPromptActive(dependencies);

  // 原因：确认框停留期间可能已从另一窗口授权，动作前必须再读一次真值。
  const afterConfirm = await readMissing();
  if (afterConfirm.length === 0) return;
  // 先直接向系统申请（main 进程触发，TCC 归属 ZCode.app）；拿不到授权就退回打开设置面板，
  // 让用户自己勾选。不再有 Helper 可重启。
  const requested = await runWithOneRetry(dependencies, dependencies.requestPermissions);
  if (!requested?.ok) {
    await runWithOneRetry(dependencies, dependencies.openSystemSettings);
  }
  assertCuaPermissionPromptActive(dependencies);
  dependencies.refresh();
}

export function CuaPermissionObservationAttachment() {
  const services = useServices();
  const platform = usePlatform();
  const confirmDialog = useConfirmDialog();
  const { intl } = useZCodeIntl();

  useEffect(() => {
    const permissionService = services.cuaPermissionService;
    const canRequest = typeof platform.requestCuaPermissions === "function";
    const canOpenSettings = typeof platform.openCuaPermissionSystemSettings === "function";
    if (
      !permissionService ||
      (!canRequest && !canOpenSettings) ||
      typeof services.zcodeAgentService.onDynamicCuaPermissionObservation !== "function"
    ) {
      return;
    }

    const handled = new Set<string>();
    const pending = new Set<string>();
    let chain = Promise.resolve();
    let disposed = false;
    const subscription = services.zcodeAgentService.onDynamicCuaPermissionObservation()(
      (observation) => {
        const missing = requiredCuaPermissionsForRequestAccessStatus(observation.permissionStatus);
        const key = cuaPermissionObservationKey(observation);
        if (disposed || missing.length === 0 || handled.has(key) || pending.has(key)) return;
        pending.add(key);

        chain = chain.then(async () => {
          if (disposed) return;
          try {
            await runCuaPermissionPrompt({
              getStatus: () =>
                permissionService.getStatus(
                  observation.workspacePath,
                  observation.workspaceIdentity,
                  { includeFunctionalProbes: false },
                ),
              confirm: () =>
                confirmDialog({
                  title: intl.formatMessage({ id: "cuaPermission.live.title" }),
                  description: intl.formatMessage({ id: "cuaPermission.live.description" }),
                  confirmLabel: intl.formatMessage({ id: "cuaPermission.live.confirm" }),
                  cancelLabel: intl.formatMessage({ id: "cuaPermission.live.cancel" }),
                }),
              requestPermissions: async () =>
                (await platform.requestCuaPermissions?.()) ?? {
                  ok: false,
                  accessibility: false,
                  screenRecording: false,
                },
              openSystemSettings: async () =>
                (await platform.openCuaPermissionSystemSettings?.()) ?? false,
              refresh: () =>
                fetchCuaPermissionStatus({
                  service: permissionService,
                  workspacePath: observation.workspacePath,
                  workspaceIdentity: observation.workspaceIdentity,
                  options: { includeFunctionalProbes: false },
                }),
              isDisposed: () => disposed,
            });
            if (disposed) return;
            // 原因：只有正常终态（包括用户取消）才能去重；异常必须允许同一 observation 再次处理。
            handled.add(key);
            if (handled.size > 2_000) {
              const oldest = handled.values().next().value;
              if (typeof oldest === "string") handled.delete(oldest);
            }
          } catch (error: unknown) {
            if (!disposed) logger.warn("CUA 权限引导失败", { error });
          } finally {
            pending.delete(key);
          }
        });
      },
    );
    return () => {
      // 原因：先封闭生命周期边界，避免已排队任务在 subscription 释放后继续触发旧 workspace 副作用。
      disposed = true;
      subscription.dispose();
    };
  }, [confirmDialog, intl, platform, services]);

  return null;
}