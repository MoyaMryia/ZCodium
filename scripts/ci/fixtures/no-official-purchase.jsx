import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BUILTIN_MODEL_PROVIDER_IDS } from "@zcode/shared";
import { ChatErrorBanner } from "../../../packages/ui/src/ChatErrorBanner.js";
import { CodingPlanStatusPanel } from "../../../packages/ui/src/settings/model-provider-section/StatusCards.js";
import { WorkspaceSidebarUsageMenuItem } from "../../../packages/ui/src/WorkspaceSidebarUsageMenuItem.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../packages/ui/src/components/ui/dropdown-menu.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
document.documentElement.classList.toggle("zai-light", params.get("theme") !== "dark");
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
document.documentElement.classList.toggle("zai-dark", params.get("theme") === "dark");
window.purchaseFixture = { configured: 0, usage: 0, retries: 0 };
const platform = {
  openFeedback() {
    throw new Error("Unexpected feedback action");
  },
};
function Fixture() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState(params.get("status") || "notPurchased");
  window.completePurchaseFixtureRetry = setStatus;
  return (
    <main className="min-h-screen bg-background text-foreground p-4 space-y-4">
      <ChatErrorBanner
        error={{ code: "MODEL_CONFIG_MISSING", message: "Internal model configuration path" }}
        onOpenModelSettings={() => {
          window.purchaseFixture.configured++;
          setSettingsOpen(true);
        }}
      />
      {settingsOpen ? (
        <section aria-label="Model settings">
          {locale === "zh-CN" ? "模型设置已打开" : "Model settings opened"}
        </section>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <WorkspaceSidebarUsageMenuItem
            onUsageClick={() => {
              window.purchaseFixture.usage++;
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <section aria-label="Connection status">
        <CodingPlanStatusPanel
          providerId={BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan}
          providerName="Fixture model"
          status={status}
          onRetry={() => {
            window.purchaseFixture.retries++;
            setStatus("checking");
          }}
          planLevel="Max"
          quotaLimits={[]}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale={locale}>
      <Fixture />
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
