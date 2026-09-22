import { cn } from "@/components/lib/utils.js";

// 品牌标记统一用打包进安装包的同一枚 ZCodium 图标，不再内联一份 Z 字 SVG——
// 否则应用图标、关于对话框会各画各的，改一次要改两处。
// 路径深度与 UpdateStatusDialog 的 public/ 引用保持一致。
const zcodiumIconUrl = new URL("../../../../public/logo/icons/512x512.png", import.meta.url).href;

/**
 * 初始化与引导共用的品牌图标。
 *
 * 图标自带 22.36% 圆角（macOS 应用图标规范），因此不再套一层 rounded 容器——
 * 双层圆角会让图标四角透出容器底色。
 * 这里只做静态标记：启动阶段的动画已经全部移除，引导页自带的扫光由调用方负责。
 */
export function ZCodeStartupLogoBadge({ className }: { className?: string }) {
  return (
    <img
      src={zcodiumIconUrl}
      alt=""
      width={96}
      height={96}
      className={cn("size-24 shrink-0", className)}
    />
  );
}
