/**
 * Computer Use 权限 IPC：只保留 cua-driver 路径。
 *
 * 闭源 `ZCode Computer Use.app` 的整套 onboarding（拖 Helper 进 TCC、系统设置窗口监视、
 * 权限浮窗、LaunchServices 权限申请）已整体移除。现在设置页与运行中权限提示都走
 * `@zcode/zcode-cua/macos-permissions`：由本进程（Electron main，app.whenReady() 之后）
 * 触发 TCC 申请或打开「屏幕录制」设置面板，授权才归属 ZCode.app。
 */
import { app, ipcMain } from "electron";
import { PlatformChannels, type CuaPermissionRequestResult } from "@zcode/shared";
import {
  openMacOSScreenRecordingSettingsPanel,
  requestMacOSPermissionsFromHost,
} from "@zcode/zcode-cua/macos-permissions";

export interface RegisterCuaPermissionIpcHandlersOptions {
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

export function registerCuaPermissionIpcHandlers(options: RegisterCuaPermissionIpcHandlersOptions) {
  // cua-driver 路径：直接向系统申请 TCC。必须在 main 进程调用，授权才归属 ZCode.app；
  // 拿不到入口（非 macOS / 原生库缺失）时 ok=false，由 UI 保持未授权态，不伪造成功。
  ipcMain.handle(
    PlatformChannels.RequestCuaPermissions,
    async (): Promise<CuaPermissionRequestResult> => {
      if (process.platform !== "darwin") {
        return { ok: false, accessibility: false, screenRecording: false };
      }
      const status = await requestMacOSPermissionsFromHost();
      if (!status) {
        options.logger.warn("[cua-permission] cua-driver permission entry unavailable");
        return {
          ok: false,
          accessibility: false,
          screenRecording: false,
          reason: "cua-driver permission entry unavailable",
        };
      }
      options.logger.info("[cua-permission] requested", status);
      return { ok: true, ...status };
    },
  );

  // cua-driver 路径：打开「屏幕录制」设置面板。返回是否成功打开；失败不抛，UI 退回文字指引。
  ipcMain.handle(PlatformChannels.OpenCuaPermissionSystemSettings, async (): Promise<boolean> => {
    if (process.platform !== "darwin") return false;
    const opened = await openMacOSScreenRecordingSettingsPanel();
    if (!opened) options.logger.warn("[cua-permission] open screen recording settings failed");
    return opened;
  });
}

/** 供 main 启动期判断权限 IPC 是否可用（当前恒真，保留以便后续加门控）。 */
export function isCuaPermissionIpcSupported(): boolean {
  return app.isPackaged || process.platform === "darwin";
}
