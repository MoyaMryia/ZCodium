/* Automations 列表状态筛选：定时任务的状态筛选项。
   分组口径以卡片实际展示的状态徽章为准，用户在列表上看到什么颜色的徽章，就落在哪一组。 */
import {
  hasAutomationFailureState,
  resolveAutomationStatusKind,
} from "@/settings/automationFormat.js";

export type AutomationStatusFilter = "all" | "inProgress" | "completed" | "failed";
type AutomationStatusFilterKind = Exclude<AutomationStatusFilter, "all">;

/** 默认显示全部定时任务。 */
export const DEFAULT_AUTOMATION_STATUS_FILTER: AutomationStatusFilter = "all";

export const AUTOMATION_STATUS_FILTERS: readonly AutomationStatusFilter[] = [
  "all",
  "inProgress",
  "completed",
  "failed",
];

type AutomationFilterLike = Parameters<typeof resolveAutomationStatusKind>[0] &
  Parameters<typeof hasAutomationFailureState>[0];

/** 定时任务：先看失败徽章（含循环任务最近一次运行失败），再看 lifecycle 终态，其余进行中。 */
function resolveAutomationStatusFilterKind(
  automation: AutomationFilterLike,
): AutomationStatusFilterKind {
  if (hasAutomationFailureState(automation)) return "failed";
  return resolveAutomationStatusKind(automation) === "completed" ? "completed" : "inProgress";
}

export function filterAutomationsByStatus<T extends AutomationFilterLike>(
  automations: readonly T[],
  filter: AutomationStatusFilter,
): readonly T[] {
  if (filter === "all") return automations;
  return automations.filter(
    (automation) => resolveAutomationStatusFilterKind(automation) === filter,
  );
}
