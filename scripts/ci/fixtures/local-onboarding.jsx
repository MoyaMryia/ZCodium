import { createRoot } from "react-dom/client";
import { OccupationOnboarding } from "../../../packages/ui/src/onboarding/OccupationOnboarding.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { StoreProvider, useZCodeStore } from "../../../packages/ui/src/store/StoreProvider.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";

const params = new URLSearchParams(location.search);
const fixture = (window.onboardingFixture = {
  reads: 0,
  writes: [],
  settingsWrites: [],
  forbidden: [],
  failNext: false,
  entry: {
    occupation: "product",
    interfaceMode: "office",
    memoryEnabled: false,
    proactiveSuggestionsEnabled: false,
    completedAt: "2026-09-24",
  },
});
let settings = { shortcutBindings: {}, locale: params.get("locale") || "en-US" };
const broadcastService = { onMessage: () => ({ dispose() {} }), async send() {} };
const forbiddenService = new Proxy(
  {},
  {
    get(_target, key) {
      fixture.forbidden.push(String(key));
      throw new Error(`Unexpected method: ${String(key)}`);
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
        return settings;
      },
      async update(patch) {
        if (fixture.failNext) {
          fixture.failNext = false;
          throw new Error("Fixture save failure");
        }
        fixture.settingsWrites.push(patch);
        settings = { ...settings, ...patch };
      },
    },
    onboardingRecordService: {
      async getLatestEntry() {
        fixture.reads++;
        if (params.get("delay"))
          return new Promise((resolve) => {
            fixture.resolveEntry = () => resolve(fixture.entry);
          });
        return fixture.entry;
      },
      async appendRecord(entry) {
        fixture.writes.push(entry);
        fixture.entry = entry;
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
function Fixture() {
  const open = useZCodeStore((state) => state.setNewUserOnboardingOpen);
  return (
    <OccupationOnboarding>
      <button onClick={() => open(true)}>Open local preferences</button>
      <div>Workspace ready</div>
    </OccupationOnboarding>
  );
}
createRoot(document.getElementById("root")).render(
  <ServiceProvider services={services}>
    <PlatformProvider platform={{}}>
      <ZCodeIntlProvider initialLocale={params.get("locale") || "en-US"}>
        <StoreProvider broadcastService={broadcastService}>
          <Fixture />
        </StoreProvider>
      </ZCodeIntlProvider>
    </PlatformProvider>
  </ServiceProvider>,
);
