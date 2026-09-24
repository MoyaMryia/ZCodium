import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createClientScenesService } from "../../../packages/services/src/client-scenes/clientScenesService.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { useDraftSuggestedPromptItems } from "../../../packages/ui/src/v4/useDraftSuggestedPromptItems.js";
import { ConversationDraftSuggestedPrompts } from "../../../packages/ui/src/v4/ConversationDraftSuggestedPrompts.js";
import { resolveDraftSuggestedPromptText } from "../../../packages/ui/src/v4/draftSuggestedPromptItems.js";
import { useAutomationTemplates } from "../../../packages/ui/src/settings/useAutomationTemplates.js";
import {
  materializeScheduledTemplateDraft,
  resolveAutomationTemplateText,
} from "../../../packages/ui/src/settings/automationTemplateCatalog.js";

const bundled = createClientScenesService();
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
        items={items}
        onSelect={(item) =>
          setSelected({ prompt: resolveDraftSuggestedPromptText(item.prompt, locale) })
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
