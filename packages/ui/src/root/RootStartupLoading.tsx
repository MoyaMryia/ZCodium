import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

// 品牌标记统一用打包进安装包的同一枚 ZCodium 图标，不再内联一份 Z 字 SVG——
// 否则应用图标、启动动画、关于对话框会各画各的，改一次要改三处。
// 路径深度与 UpdateStatusDialog 的 public/ 引用保持一致。
const zcodiumIconUrl = new URL("../../../../public/logo/icons/512x512.png", import.meta.url).href;

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/**
 * 初始化与引导共用的品牌图标。
 *
 * 图标自带 22.36% 圆角（macOS 应用图标规范），因此不再套一层 rounded 容器——
 * 双层圆角会让图标四角透出容器底色。呼吸动画对应原 SVG <animate> 的
 * opacity 1→0.4→1 循环；这里用 Tailwind 的 animate-pulse 表达同一语义。
 */
export function ZCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <img
      src={zcodiumIconUrl}
      alt=""
      width={96}
      height={96}
      className={cn("size-24 shrink-0", animated && "animate-pulse")}
    />
  );
}
