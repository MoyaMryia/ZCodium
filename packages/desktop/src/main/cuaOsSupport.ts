import { release } from "node:os";
import type { CuaOsSupport } from "@zcode/shared";

// macOS 地板：cua-driver 的 Electron 入口（TCC 申请）在低版本系统上不可用。
// 低于地板时设置页渲染升级提示卡，隐藏授权操作区。
const CUA_MINIMUM_MACOS_VERSION = "12.0";
// 与 @trycua/cua-driver 的 macOS 支持下限联动；bump 任一侧必须同步其余常量。
const CUA_MINIMUM_DARWIN_MAJOR = 21; // Darwin major - 9 = macOS major（21↔12, 22↔13）

function darwinMajorToMacosMajor(major: number): number {
  return major - 9;
}

export function resolveCuaOsSupport(
  platform = process.platform,
  darwinRelease = release(),
): CuaOsSupport {
  if (platform !== "darwin") return { kind: "not-applicable" };
  const major = Number.parseInt(darwinRelease.split(".")[0] ?? "0", 10);
  if (Number.isNaN(major)) return { kind: "supported" };
  if (major < CUA_MINIMUM_DARWIN_MAJOR) {
    return {
      kind: "macos-below-minimum",
      minimumMacOs: CUA_MINIMUM_MACOS_VERSION,
      currentMacOs: String(darwinMajorToMacosMajor(major)),
    };
  }
  return { kind: "supported" };
}
