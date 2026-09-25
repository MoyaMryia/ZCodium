import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCommandIds } from "@zcode/shared";
import { WorkspaceSidebarFooter } from "../../../packages/ui/src/WorkspaceSidebarFooter.js";
import { WorkspaceHeaderActionSection } from "../../../packages/ui/src/WorkspaceHeaderSections/WorkspaceHeaderActionSection.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { StoreProvider, useZCodeStore } from "../../../packages/ui/src/store/StoreProvider.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
import { consumeInitialSettingsSection } from "../../../packages/ui/src/lib/settingsNavigation.js";

const params = new URLSearchParams(location.search);
window.preferencesFixture = {
  calls: [],
  commands: [],
  changes: [],
  forbidden: [],
  usage: 0,
  settings: 0,
  zoomListeners: 0,
};
const fixture = window.preferencesFixture;
const broadcastListeners = new Set();
fixture.receiveBroadcast = (message) => {
  for (const listener of broadcastListeners) listener(message);
};
const broadcastService = {
  onMessage(listener) {
    broadcastListeners.add(listener);
    return { dispose: () => broadcastListeners.delete(listener) };
  },
  async send(message) {
    fixture.changes.push(message);
  },
};
const forbiddenService = new Proxy(
  {},
  {
    get(_target, key) {
      fixture.forbidden.push(String(key));
      throw new Error(`Unexpected service method: ${String(key)}`);
    },
  },
);
const services = new Proxy(
  {
    broadcastService,
    botsService: forbiddenService,
    zcodeAgentService: forbiddenService,
    settingService: {
      async get() {
        fixture.calls.push("settings.get");
        if (params.get("mode") === "read-failure")
          throw new Error("Fixture local settings read failure");
        return { shortcutBindings: {} };
      },
    },
  },
  {
    get(target, key) {
      if (key in target) return target[key];
      fixture.forbidden.push(String(key));
      throw new Error(`Unexpected service: ${String(key)}`);
    },
  },
);
let zoom = 0;
const zoomListeners = new Set();
fixture.setZoom = (zoomLevel) => {
  zoom = zoomLevel;
  for (const listener of zoomListeners) listener({ zoomLevel });
};
const platform = {
  async getInstalledEditors() {
    return [];
  },
  async getDesktopZoomLevel() {
    return { zoomLevel: zoom };
  },
  onDesktopZoomLevelChanged(listener) {
    zoomListeners.add(listener);
    fixture.zoomListeners = zoomListeners.size;
    return () => {
      zoomListeners.delete(listener);
      fixture.zoomListeners = zoomListeners.size;
    };
  },
  async executeDesktopCommand(command) {
    fixture.commands.push(command);
    fixture.setZoom(
      command === DesktopCommandIds.ResetZoom
        ? 0
        : zoom + (command === DesktopCommandIds.ZoomIn ? 1 : -1),
    );
  },
};
function Fixture() {
  const storeState = useZCodeStore((state) => state);
  fixture.readState = () => storeState;
  const { localePreference, setLocalePreference } = useZCodeIntl();
  const theme = useZCodeStore((state) => state.theme);
  const setTheme = useZCodeStore((state) => state.setTheme);
  const setUser = useZCodeStore((state) => state.setUser);
  const [mounted, setMounted] = useState(true);
  const [taskId, setTaskId] = useState("fixture-task");
  fixture.setTaskId = setTaskId;
  fixture.unmount = () => setMounted(false);
  useEffect(() => {
    setUser({
      id: "fixture-retired-account",
      displayName: "Retired account",
      avatarUrl: "https://avatar.example.invalid/private.png",
    });
    setTheme(params.get("theme") === "dark" ? "zai-dark" : "zai-light");
  }, [setTheme, setUser]);
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground">
      <WorkspaceHeaderActionSection
        activeTaskId={taskId}
        workspaceAbsPath="/fixture"
        isDesktop={params.get("platform") !== "web"}
        isTerminalOpen={false}
        isSidePaneOpen
        hideHelpMenu
        onToggleTerminal={() => {}}
        onToggleSidePane={() => {}}
      />
      <div className="flex-1 p-4">Workspace</div>
      {mounted ? (
        <div className="w-full max-w-80 border-t border-border bg-sidebar">
          <WorkspaceSidebarFooter
            theme={theme}
            localeMenuValue={localePreference}
            onLocaleChange={(value) => {
              fixture.changes.push({ locale: value });
              setLocalePreference(value);
            }}
            onThemeChange={setTheme}
            onSettingsButtonClick={
              params.get("mode") === "no-navigation"
                ? undefined
                : () => {
                    fixture.settings++;
                  }
            }
            onUsageClick={
              params.get("mode") === "no-navigation"
                ? undefined
                : () => {
                    fixture.usage++;
                    fixture.usageIntent = consumeInitialSettingsSection();
                  }
            }
            settingsButtonMode={params.get("mode") === "back" ? "back" : "settings"}
            isDesktop={params.get("platform") !== "web"}
          />
        </div>
      ) : null}
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <ServiceProvider services={services}>
    <PlatformProvider platform={platform}>
      <ZCodeIntlProvider initialLocale={params.get("locale") || "en-US"}>
        <StoreProvider broadcastService={broadcastService}>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </StoreProvider>
      </ZCodeIntlProvider>
    </PlatformProvider>
  </ServiceProvider>,
);
