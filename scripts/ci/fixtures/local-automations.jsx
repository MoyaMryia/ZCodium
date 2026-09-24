import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AutomationsSection } from "../../../packages/ui/src/settings/AutomationsSection.js";
import { OffPeakCreateTaskCard } from "../../../packages/ui/src/ToolCallBlocks/renderers/offpeak-create.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import {
  TabStoreProvider,
  useTabStoreApi,
} from "../../../packages/ui/src/store/TabStoreProvider.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
import { useAutomationManagementStore } from "../../../packages/ui/src/store/automationManagementStore.js";
const params = new URLSearchParams(location.search);
const fixture = (window.localAutomationsFixture = {
  calls: [],
  forbidden: [],
  consumed: 0,
  chat: [],
  failNext: false,
  failSave: false,
  readState: () => useAutomationManagementStore.getState(),
});
const selection = {
  providerId: "fixture-api",
  modelId: "Fixture model",
  options: { reasoningLevel: "high" },
};
const modelView = {
  revision: 1,
  preferredSelection: selection,
  providers: [
    {
      providerId: "fixture-api",
      providerName: "Fixture API",
      config: {
        group: "standard-personal",
        access: { type: "api-key" },
        api: { type: "openai-chat-completions" },
      },
      models: [
        {
          modelId: "Fixture model",
          config: {
            optionSpecs: { reasoningLevel: { values: ["high"], map: "{}" } },
            properties: { inputFormat: { supportsImage: false } },
          },
        },
      ],
    },
  ],
};
const scheduled = ["active", "completed", "failed"].map((lifecycleStatus, index) => ({
  automationId: `fixture-${index}`,
  title: `Fixture ${lifecycleStatus}`,
  prompt: "Fixture task instructions",
  workspacePath: "/fixture/project",
  cronExpr: "0 9 * * *",
  enabled: true,
  mode: "build",
  modelSelection: selection,
  recurring: true,
  runCount: 0,
  workspaceKey: "/fixture/project",
  lifecycleStatus,
  nextRunAt: Date.now() + 3600000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
}));
const created = [];
const agent = {
  async listAllAutomations() {
    fixture.calls.push("list");
    if (fixture.failNext) {
      fixture.failNext = false;
      throw new Error("Fixture local read failure");
    }
    return structuredClone(params.has("empty") ? created : [...scheduled, ...created]);
  },
  async createAutomation(input) {
    fixture.calls.push({ create: input });
    const automation = { ...scheduled[0], ...input, automationId: `created-${created.length}` };
    created.push(automation);
    return structuredClone(automation);
  },
  async updateAutomation(input) {
    fixture.calls.push({ update: input });
    if (fixture.failSave) {
      fixture.failSave = false;
      throw new Error("Fixture save failure");
    }
    Object.assign(
      scheduled.find((item) => item.automationId === input.automationId),
      input,
    );
  },
  async listAutomationRuns(input) {
    fixture.calls.push({ runs: input });
    return [];
  },
};
let settings = { keepAwakeWhileRunning: false };
const services = new Proxy(
  {
    zcodeAgentService: agent,
    botsService: {},
    broadcastService: {},
    clientScenesService: {
      async list() {
        return {
          code: 0,
          data: [
            {
              scene: "scheduled-task",
              options: {
                prompts: {
                  items: [
                    {
                      id: "local-template",
                      labels: { en: "Fixture template", cn: "本地模板" },
                      contents: { en: "Fixture template instructions", cn: "模板任务指令" },
                      defaults: { cronExpr: ["daily"] },
                    },
                  ],
                },
                cronExpr: { items: [{ id: "daily", contents: { en: "0 9 * * *" } }] },
              },
            },
          ],
        };
      },
    },
    settingService: {
      async get() {
        return settings;
      },
      async update(patch) {
        fixture.calls.push({ settings: patch });
        settings = { ...settings, ...patch };
        return settings;
      },
    },
    modelSelectionService: {
      async getView(input) {
        return { ...modelView, effectiveSelection: input?.selection ?? selection };
      },
      onDidChange() {
        return { dispose() {} };
      },
    },
  },
  {
    get(target, key) {
      if (key in target) return target[key];
      fixture.forbidden.push(String(key));
      throw new Error(`Unexpected automation service: ${String(key)}`);
    },
  },
);
const platform = {
  onBroadcastMessage() {
    return () => {};
  },
  broadcastMessage() {},
};
function Fixture() {
  const tabs = useTabStoreApi();
  useEffect(() => {
    tabs.getState().addTab("/fixture/project");
  }, [tabs]);
  const [navigation, setNavigation] = useState({ tab: params.get("tab"), id: params.get("id") });
  fixture.navigate = setNavigation;
  return (
    <main className="min-h-screen bg-background text-foreground p-4">
      <AutomationsSection
        workspacePath="/fixture/project"
        openAutomationTab={navigation.tab}
        openAutomationId={navigation.id}
        onOpenAutomationConsumed={() => {
          fixture.consumed++;
          setNavigation({});
        }}
        onCreateViaChat={(prompt) => fixture.chat.push(prompt)}
      />
      <aside aria-label="Historical task">
        <OffPeakCreateTaskCard
          task={{ offPeakTaskId: "offpeak-old", title: "Historical idle task", queuePosition: 3 }}
        />
      </aside>
    </main>
  );
}
document.documentElement.className = params.get("theme") === "dark" ? "dark zai-dark" : "zai-light";
createRoot(document.getElementById("root")).render(
  <ServiceProvider services={services}>
    <PlatformProvider platform={platform}>
      <TabStoreProvider>
        <ZCodeIntlProvider initialLocale={params.get("locale") || "en-US"}>
          <TooltipProvider>
            <Fixture />
          </TooltipProvider>
        </ZCodeIntlProvider>
      </TabStoreProvider>
    </PlatformProvider>
  </ServiceProvider>,
);
