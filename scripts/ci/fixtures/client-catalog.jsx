import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createClientScenesService } from "../../../packages/services/src/client-scenes/clientScenesService.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { useDraftSuggestedPromptItems } from "../../../packages/ui/src/v4/useDraftSuggestedPromptItems.js";
import { ConversationDraftSuggestedPrompts } from "../../../packages/ui/src/v4/ConversationDraftSuggestedPrompts.js";
import { resolveDraftSuggestedPromptText } from "../../../packages/ui/src/v4/draftSuggestedPromptItems.js";
import { getRecommendedPromptPool } from "../../../packages/ui/src/v4/featureSuggestedPrompts.js";
import { useAutomationTemplates } from "../../../packages/ui/src/settings/useAutomationTemplates.js";
import {
  materializeScheduledTemplateDraft,
  resolveAutomationTemplateText,
} from "../../../packages/ui/src/settings/automationTemplateCatalog.js";

const bundled = createClientScenesService();
const query = new URLSearchParams(location.search);
const featureMode = query.get("mode");
const featureItems = featureMode ? getRecommendedPromptPool(featureMode === "office") : null;
window.featureItems = featureItems;
window.catalogReadCount = 0;
const clientScenesService = {
  async list() {
    window.catalogReadCount += 1;
    return bundled.list();
  },
};

function Catalog() {
  const { locale } = useZCodeIntl();
  const [selected, setSelected] = useState(null);
  const items = useDraftSuggestedPromptItems({
    clientScenesService,
    rpcReady: true,
    workspaceKey: "fixture",
  });
  const templates = useAutomationTemplates(clientScenesService);
  return (
    <>
      <ConversationDraftSuggestedPrompts
        items={featureItems ?? items}
        layout={featureItems ? "list" : "chips"}
        onSelect={(item) =>
          setSelected({
            id: item.id,
            plugin: item.plugin?.stableId,
            prompt: resolveDraftSuggestedPromptText(item.prompt, locale),
          })
        }
      />
      {templates.scheduled.map((template) => (
        <button
          key={template.id}
          data-testid={`template-${template.id}`}
          onClick={() => setSelected(materializeScheduledTemplateDraft(template, locale))}
        >
          {resolveAutomationTemplateText(template.title, locale)}
        </button>
      ))}
      <output data-testid="selected">{JSON.stringify(selected)}</output>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <ZCodeIntlProvider initialLocale={new URLSearchParams(location.search).get("locale") || "en-US"}>
    <Catalog />
  </ZCodeIntlProvider>,
);
