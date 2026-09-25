import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ZCodeIntlProvider } from "../../../packages/ui/src/i18n/IntlProvider.js";
import { PluginConfigControls } from "../../../packages/ui/src/settings/PluginConfigControls.js";
import { buildPluginConfigPatch } from "../../../packages/ui/src/settings/pluginConfigPatch.js";
import manifest from "../../../apps/zcode-cli/packages/image-search-plugin/.zcodium-plugin/plugin.json";

// 仅替代持久化边界；使用真实配置控件、manifest 和 patch 构造器。
function Fixture() {
  const [drafts, setDrafts] = useState({});
  const [configuredOptions, setConfigured] = useState({
    authorizationHeader: "Bearer fixture-secret",
  });
  const plugin = {
    id: "image-search@zcode-plugins-official",
    userConfig: manifest.userConfig,
    configuredOptions,
    optionSources: Object.fromEntries(Object.keys(configuredOptions).map((key) => [key, "user"])),
  };
  return (
    <main className="p-4">
      <PluginConfigControls
        plugin={plugin}
        scope="user"
        operationId={null}
        getValue={(_, key, option) =>
          drafts[key] === null
            ? ""
            : (drafts[key] ?? configuredOptions[key] ?? option.default ?? "")
        }
        onSetDraft={(_, key, value) => setDrafts((current) => ({ ...current, [key]: value }))}
        isOptionClearPending={(_, key) => drafts[key] === null}
        onClearOption={(_, key, clear) =>
          setDrafts((current) => {
            const next = { ...current };
            if (clear) next[key] = null;
            else delete next[key];
            return next;
          })
        }
        onSave={() => {
          const patch = buildPluginConfigPatch(plugin, drafts);
          window.imageSearchPatch = patch;
          setConfigured((current) => {
            const next = { ...current, ...patch.options };
            for (const key of patch.clearOptionKeys) delete next[key];
            return next;
          });
          setDrafts({});
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <ZCodeIntlProvider initialLocale={new URLSearchParams(location.search).get("locale") || "en-US"}>
    <Fixture />
  </ZCodeIntlProvider>,
);
