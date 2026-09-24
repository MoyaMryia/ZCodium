import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import { Cron } from "croner";

const { createClientScenesService } = await tsImport(
  "../../packages/services/src/client-scenes/clientScenesService.ts",
  import.meta.url,
);
const { createClientConfigService } = await tsImport(
  "../../packages/services/src/client-config/clientConfigService.ts",
  import.meta.url,
);
const { mapClientScenesToDraftSuggestedPromptItems, resolveDraftSuggestedPromptText } =
  await tsImport("../../packages/ui/src/v4/draftSuggestedPromptItems.ts", import.meta.url);
const { mapClientScenesToAutomationTemplates, materializeScheduledTemplateDraft } = await tsImport(
  "../../packages/ui/src/settings/automationTemplateCatalog.ts",
  {
    parentURL: import.meta.url,
    tsconfig: fileURLToPath(new URL("../../packages/ui/tsconfig.json", import.meta.url)),
  },
);

const forbiddenNetwork = {
  apiClient: {
    request() {
      throw new Error("network forbidden");
    },
  },
  resolveRequestContext() {
    throw new Error("endpoint/device context forbidden");
  },
};

test("bundled recommendations and scheduled templates remain usable without any network context", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("fetch forbidden");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const response = await createClientScenesService(forbiddenNetwork).list();
  assert.equal(response.code, 0);
  const prompts = mapClientScenesToDraftSuggestedPromptItems(response.data);
  assert.ok(prompts.length >= 4);
  const templates = mapClientScenesToAutomationTemplates(response.data, (value) => {
    const cron = new Cron(value, { paused: true });
    try {
      return Boolean(cron.nextRun());
    } finally {
      cron.stop();
    }
  });
  assert.deepEqual(templates.rejectedScheduledTemplateIds, []);
  assert.ok(templates.scheduled.length >= 3);
  assert.deepEqual(templates.offPeak, []);
  for (const locale of ["zh-CN", "en-US"]) {
    for (const prompt of prompts) {
      assert.ok(resolveDraftSuggestedPromptText(prompt.label, locale));
      assert.ok(resolveDraftSuggestedPromptText(prompt.prompt, locale));
      assert.ok(!prompt.iconUrl);
      assert.ok(!prompt.actions?.includes("NAVIGATE:AUTOMATIONS:OFFPEAK"));
    }
    for (const template of templates.scheduled) {
      const draft = materializeScheduledTemplateDraft(template, locale);
      assert.ok(draft.title && draft.prompt);
      assert.equal(draft.cronExpr, template.cronExpr);
    }
  }
  assert.doesNotMatch(JSON.stringify(response), /https?:\/\//);
});

test("callers cannot mutate bundled scenes or public config for later reads", async () => {
  const scenes = createClientScenesService(forbiddenNetwork);
  const expectedScenes = await scenes.list();
  const mutated = await scenes.list();
  mutated.data[0].options.prompts.items[0].contents.cn = "changed by caller";
  mutated.data.splice(1);
  assert.deepEqual(await scenes.list(), expectedScenes);
  assert.deepEqual(await createClientScenesService(forbiddenNetwork).list(), expectedScenes);
  const config = createClientConfigService(forbiddenNetwork);
  const snapshot = await config.getSnapshot();
  assert.deepEqual(snapshot, { pluginStoreOrder: null });
  snapshot.pluginStoreOrder = { code: { categoryOrder: ["caller"] } };
  assert.deepEqual(await config.getSnapshot({ forceRefresh: true }), { pluginStoreOrder: null });
});
