import { TID_SIDEBAR_USAGE_BUTTON } from "@zcode/shared";
import { BarChart3Icon } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setPendingSettingsUsageIntent } from "@/lib/settingsNavigation.js";

export function WorkspaceSidebarUsageMenuItem({ onUsageClick }: { onUsageClick?: () => void }) {
  const { intl } = useZCodeIntl();

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid={TID_SIDEBAR_USAGE_BUTTON}
        disabled={!onUsageClick}
        onSelect={() => {
          if (!onUsageClick) return;
          setPendingSettingsUsageIntent();
          onUsageClick();
        }}
      >
        <BarChart3Icon className="size-4" />
        {intl.formatMessage({ id: "sidebar.usage.plan.openStats" })}
      </DropdownMenuItem>
    </>
  );
}
