import { AppUsagePanel } from "@/settings/usage-stats/AppUsagePanel.js";

export function UsageStatsSection() {
  // 使用统计由 Agent 本地记录提供，不再等待或查询官方套餐来源。
  return <AppUsagePanel />;
}
