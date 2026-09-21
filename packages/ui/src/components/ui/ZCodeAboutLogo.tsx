import { cn } from "@/components/lib/utils.js";

// 与 RootStartupLoading 共用同一枚 ZCodium 图标，避免应用图标/关于页各画各的。
const zcodiumIconUrl = new URL("../../../public/logo/icons/512x512.png", import.meta.url).href;

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return <img src={zcodiumIconUrl} alt="" className={cn("shrink-0", className)} />;
}
