import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCODE_AGENT_PROVIDER } from "@zcode/shared";
import { ChatContextUsage } from "../../../packages/ui/src/chat-input-toolbar/contextUsage.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
document.documentElement.className = params.get("theme") === "dark" ? "dark zai-dark" : "zai-light";
function Fixture() {
  const { intl, locale } = useZCodeIntl();
  const [usage, setUsage] = useState({
    used: 1000,
    size: 10000,
    cache: { hitRate: 0.9 },
    breakdown: [
      { source: "messages", chars: 200 },
      { source: "messages", chars: 100 },
      { source: "skills", chars: 100 },
      { source: "tool_prompt", chars: -10 },
    ],
  });
  window.contextFixture = { setUsage };
  return (
    <main className="flex min-h-screen flex-col justify-end items-center gap-4 bg-background text-foreground p-6">
      <button type="button">Before context</button>
      <ChatContextUsage
        taskUsage={usage}
        selectedProvider={ZCODE_AGENT_PROVIDER}
        intl={intl}
        locale={locale}
      />
      <button type="button">After context</button>
    </main>
  );
}
// No ServiceProvider, account context or global stores: the display must be local-only.
createRoot(document.getElementById("root")).render(
  <ZCodeIntlProvider initialLocale={locale}>
    <Fixture />
  </ZCodeIntlProvider>,
);
