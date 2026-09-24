import { createRoot } from "react-dom/client";
import { ConversationShareImportNotice } from "../../../packages/ui/src/v4/ConversationShareImportNotice.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";

const locale = new URLSearchParams(location.search).get("locale") || "en-US";
const base = {
  turnId: "share-turn-1",
  productTurnId: "share-product-turn-1",
  createdAt: 1,
  createdAtSeq: 1,
};
const rows = [
  {
    ...base,
    rowId: 1,
    kind: "turnHeader",
    origin: "userInput",
    state: "completedSuccess",
    startedAt: 1,
  },
  {
    ...base,
    rowId: 2,
    kind: "userInput",
    origin: "realUser",
    text: "Please keep this conversation available offline.",
  },
  {
    ...base,
    rowId: 3,
    kind: "assistantText",
    state: "complete",
    text: "The imported conversation stays on this device.",
  },
];
window.externalActions = [];
const platform = { openExternal: (url) => window.externalActions.push(url) };
createRoot(document.getElementById("root")).render(
  <PlatformProvider platform={platform}>
    <ZCodeIntlProvider initialLocale={locale}>
      <main className="mx-auto w-full max-w-3xl p-4 text-ui-base text-foreground bg-background">
        <ConversationShareImportNotice rows={rows} locale={locale} />
        <label htmlFor="message">{locale === "zh-CN" ? "消息" : "Message"}</label>
        <textarea id="message" className="w-full border" />
      </main>
    </ZCodeIntlProvider>
  </PlatformProvider>,
);
