import { AlertTriangle } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function UsageStatsErrorNotice() {
  const { intl } = useZCodeIntl();
  // 此页只读 Agent 本地数据库；本地失败不能被误判为官方凭据问题或回显内部错误。
  return (
    <div role="alert" className="flex min-w-0 items-start gap-1.5 text-ui-base text-destructive">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{intl.formatMessage({ id: "usage.error.stats.generic" })}</span>
    </div>
  );
}
