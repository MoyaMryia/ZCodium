import { cn } from "@/components/lib/utils.js";

// 与 RootStartupLoading 共用同一枚 ZCodium 图标，避免应用图标/关于页各画各的。
// 本文件在 src/components/ui/ 下，比 src/root/ 深一级，需要五级 ../ 才到仓库根的
// public/；少一级会指向 packages/ui/public/，少两级指向 packages/public/，都不存在。
const zcodiumIconUrl = new URL("../../../../../public/logo/icons/512x512.png", import.meta.url)
  .href;

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return <img src={zcodiumIconUrl} alt="" className={cn("shrink-0", className)} />;
}
