import { readSafeLocalStorage, writeSafeLocalStorage } from "@/lib/browserEnvironment.js";

/**
 * 启动动画偏好的 localStorage 镜像 key。
 *
 * HTML 启动壳在 React 之前渲染，拿不到 settingService（renderer 无 fs、也不能 await RPC），
 * 只能像 `zcode-theme` 一样读一份本地镜像。真实事实源仍是 settingService 的
 * `~/.zcodium/v2/setting.json`，这里只是启动期的读取通道，不承担第二份落盘真相。
 */
export const STARTUP_ANIMATION_STORAGE_KEY = "zcode-startup-animation";

/** 关闭启动动画时写入 "off"；其余值（含缺失）都按开启处理。 */
export function readStartupAnimationDisabled(): boolean {
  return readSafeLocalStorage(STARTUP_ANIMATION_STORAGE_KEY) === "off";
}

export function writeStartupAnimationDisabled(disabled: boolean): void {
  writeSafeLocalStorage(STARTUP_ANIMATION_STORAGE_KEY, disabled ? "off" : "on");
}
