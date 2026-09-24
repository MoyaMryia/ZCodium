import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { CodingPlanLoginOptions } from "./codingPlanPricingCards.js";

export function CodingPlanStatusActions({
  providerName,
  isDisconnected,
  isUnavailable,
  isPurchased,
  loginLoading,
  loginButtonId,
  loginVisible,
  canDisconnectProvider,
  disconnectLoading,
  onLogin,
  onDisconnect,
}: {
  providerName: string;
  isDisconnected: boolean;
  isUnavailable: boolean;
  isPurchased: boolean;
  loginLoading?: boolean;
  loginButtonId: string;
  loginVisible: boolean;
  canDisconnectProvider: boolean;
  disconnectLoading?: boolean;
  onLogin?: (options?: CodingPlanLoginOptions) => void;
  onDisconnect?: () => void;
}) {
  const { intl } = useZCodeIntl();

  return (
    <div className="flex shrink-0 flex-wrap justify-start gap-2">
      {loginVisible && (isDisconnected || isUnavailable) && onLogin ? (
        <Button type="button" size="lg" onClick={() => onLogin()} disabled={loginLoading}>
          {loginLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({ id: loginButtonId }, { provider: providerName })}
        </Button>
      ) : null}
      {canDisconnectProvider && onDisconnect && !isPurchased ? (
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={disconnectLoading}
          onClick={onDisconnect}
        >
          {disconnectLoading ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {intl.formatMessage({
            id: "settings.modelProvider.codingPlan.disconnect",
          })}
        </Button>
      ) : null}
    </div>
  );
}
