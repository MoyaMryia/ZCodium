import type { ReactNode } from "react";
import { ZCodeStartupLogoBadge } from "@/root/ZCodeStartupLogoBadge.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

/**
 * 启动门禁期间的满屏底与品牌标记。
 *
 * HTML 启动壳（透明窗口上的浮动 logo、遮罩与动画）已整套删除，启动期间只剩这一处
 * 静态 ZCodium 标记。这里必须由自身承接主题背景，否则门禁阻塞期主窗口（透明/vibrancy）
 * 会露出桌面或白底。
 */
export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
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
