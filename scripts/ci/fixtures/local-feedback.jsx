import { createRoot } from "react-dom/client";
import { WorkspaceHelpMenuButton } from "../../../packages/ui/src/WorkspaceHelpMenuButton.js";
import { SessionSubscriptionErrorPanel } from "../../../packages/ui/src/v4/SessionSubscriptionErrorPanel.js";
import { RemoteConnectionConnectingStep } from "../../../packages/ui/src/remote-connection/RemoteConnectionConnectingStep.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
const params = new URLSearchParams(location.search);
window.actions = [];
const record =
  (name) =>
  (...args) => {
    window.actions.push({ name, args });
    return Promise.resolve({ success: true });
  };
const platform = {
  openFeedback: record("feedback"),
  openCommunity: record("community"),
  openExternal: record("external"),
  exportLogs: record("export"),
  executeDesktopCommand: record("command"),
  captureWindowScreenshot() {
    throw new Error("screenshot collection forbidden");
  },
};
createRoot(document.getElementById("root")).render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale={params.get("locale") || "en-US"}>
      <TooltipProvider>
        <WorkspaceHelpMenuButton isDesktop={params.get("desktop") === "1"} />
        <section data-testid="session-error">
          <SessionSubscriptionErrorPanel
            error="PRIVATE fixture error"
            onReconnect={() => void record("reconnect")()}
          />
        </section>
        <section data-testid="remote-error">
          <RemoteConnectionConnectingStep
            logs={[]}
            errorMessage="PRIVATE remote error"
            loading={false}
            onBack={() => void record("back")()}
            onRetry={() => void record("retry")()}
          />
        </section>
      </TooltipProvider>
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
