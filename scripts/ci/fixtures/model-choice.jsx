import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  TestSubagentForm,
  TestModelOverride,
} from "../../../packages/ui/src/settings/SubagentsSection.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { TooltipProvider } from "../../../packages/ui/src/components/ui/tooltip.js";
import { buildRegistryModelSelectGroups } from "../../../packages/ui/src/lib/modelSelectionGroups.js";
import { ZCODE_AGENT_PROVIDER, decodeCustomModelValue } from "@zcode/shared";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
document.documentElement.className = params.get("theme") === "dark" ? "dark zai-dark" : "zai-light";
const view = {
  revision: 1,
  providers: [
    {
      providerId: "fixture-api",
      providerName: "Fixture API",
      config: {
        group: "standard-personal",
        access: { type: "api-key" },
        api: { type: "openai-chat-completions" },
      },
      models: ["Model A", "Model B"].map((modelId) => ({
        modelId,
        config: {
          optionSpecs: { reasoningLevel: { values: ["high"], map: "{}" } },
          properties: { inputFormat: { supportsImage: false } },
        },
      })),
    },
  ],
};
const groups = buildRegistryModelSelectGroups(ZCODE_AGENT_PROVIDER, view);
const selected = {
  providerId: "fixture-api",
  modelId: "Model A",
  options: { reasoningLevel: "high" },
};
const initial = {
  name: "fixture-agent",
  description: "Fixture description",
  systemPrompt: "Fixture prompt",
  color: "blue",
  source: "user",
  scope: "user",
  modelSelection: selected,
};
window.modelChoiceFixture = { saved: [], overrides: [], failNext: false };

function Fixture() {
  const [agent, setAgent] = useState({
    name: "Explore",
    source: "built-in",
    scope: "built-in",
    modelSelectionOverride: selected,
  });
  return (
    <main className="min-h-screen bg-background text-foreground p-3 space-y-4">
      <section aria-label="User subagent">
        <TestSubagentForm
          initial={initial}
          modelSelectionView={view}
          modelSelectionLoading={false}
          modelSelectGroups={groups}
          saving={false}
          onCancel={() => {}}
          onSave={async (input) => window.modelChoiceFixture.saved.push(input)}
          scopeKey="user"
          workspaceTabs={[]}
          onScopeKeyChange={() => {}}
        />
      </section>
      <section aria-label="Built-in subagent">
        <TestModelOverride
          agent={agent}
          disabled={false}
          modelGroups={groups}
          modelSelectionView={view}
          modelSelectionLoading={false}
          onModelOverrideChange={async (_agent, config) => {
            window.modelChoiceFixture.overrides.push(config);
            if (window.modelChoiceFixture.failNext) {
              window.modelChoiceFixture.failNext = false;
              throw new Error("Fixture save failure");
            }
            const parsed = config.model ? decodeCustomModelValue(config.model) : undefined;
            setAgent({
              ...agent,
              modelSelectionOverride: parsed
                ? {
                    providerId: parsed.providerId,
                    modelId: parsed.modelName,
                    options: { reasoningLevel: config.thoughtLevel },
                  }
                : undefined,
            });
          }}
        />
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")).render(
  <ZCodeIntlProvider initialLocale={locale}>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </ZCodeIntlProvider>,
);
