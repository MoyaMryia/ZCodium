import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { NewTaskButtonGroup } from "../../../packages/ui/src/NewTaskButtonGroup.js";
import { useConversationArchiveImport } from "../../../packages/ui/src/root/useConversationArchiveImport.js";
import { ConversationImportProvider } from "../../../packages/ui/src/hooks/useConversationImport.js";
import { selectBrowserFileData } from "../../../packages/ui/src/lib/browserFilePicker.js";
import { ZCodeIntlProvider, useZCodeIntl } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { PlatformProvider } from "../../../packages/ui/src/hooks/usePlatform.js";
import { ServiceProvider } from "../../../packages/ui/src/hooks/useServices.js";

const params = new URLSearchParams(location.search);
const locale = params.get("locale") || "en-US";
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");
const outcome = params.get("outcome") || "success";
window.importCalls = { begins: 0, imports: 0, releases: 0, created: 0, opens: [] };
const calls = window.importCalls;
window.pendingImportResolvers = [];
let parts = [];
let listener;
const service = {
  canImport: async () => outcome !== "unavailable",
  onDynamicImportProgress: () => (callback) => {
    listener = callback;
    return {
      dispose: () => {
        listener = undefined;
      },
    };
  },
  beginArchiveImport: async (size) => {
    calls.begins++;
    calls.size = size;
    parts = [];
    return "handle";
  },
  appendArchiveImport: async (_id, offset, encoded) => {
    if (offset !== parts.length) throw new Error("non-sequential transfer");
    parts.push(...Array.from(atob(encoded), (char) => char.charCodeAt(0)));
  },
  releaseArchiveImport: async () => {
    calls.releases++;
  },
  importShare: async (input) => {
    calls.imports++;
    calls.bytes = parts;
    calls.target = input;
    listener?.({ phase: "committing" });
    if (outcome === "switch")
      await new Promise((resolve) => window.pendingImportResolvers.push(resolve));
    if (outcome === "failure" && calls.imports === 1) throw new Error("fixture reply lost");
    if (outcome === "corrupt")
      throw Object.assign(new Error("invalid file"), { kind: "invalid_contract" });
    return {
      workspacePath: "/fixture/workspace",
      sessionId: "imported-session",
      contextId: "context",
      title: "Offline note",
      reused: calls.imports > 1,
    };
  },
};
const platform = { selectFileData: selectBrowserFileData };
const services = { conversationShareService: service };
function Fixture() {
  const { intl } = useZCodeIntl();
  const [opened, setOpened] = useState(false);
  const importer = useConversationArchiveImport({
    platform,
    intl,
    locale,
    tabs: [],
    activeWorkspacePath: "/fixture/workspace",
    activateTabByPath: (path) => {
      calls.opens.push(path);
      setOpened(true);
      return true;
    },
    addTab: () => {
      throw new Error("must reuse existing tab");
    },
  });
  return (
    <main className="p-4 bg-background text-foreground min-h-screen">
      <div className="w-full max-w-64">
        <ConversationImportProvider value={importer}>
          <NewTaskButtonGroup
            onCreateTask={() => {
              calls.created++;
            }}
          />
        </ConversationImportProvider>
      </div>
      {opened ? (
        <p role="status">
          {locale === "zh-CN" ? "已打开导入的会话" : "Imported conversation opened"}
        </p>
      ) : null}
    </main>
  );
}
function App() {
  const [version, setVersion] = useState(0);
  window.replaceImportHost = () => setVersion((value) => value + 1);
  const scopedServices = useMemo(
    () => ({ ...services, conversationShareService: { ...service } }),
    [version],
  );
  return (
    <PlatformProvider platform={platform}>
      <ServiceProvider services={scopedServices}>
        <ZCodeIntlProvider initialLocale={locale}>
          <Fixture />
        </ZCodeIntlProvider>
      </ServiceProvider>
    </PlatformProvider>
  );
}
createRoot(document.getElementById("root")).render(<App />);
