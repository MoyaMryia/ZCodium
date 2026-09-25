import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const { mapClientScenesToAutomationTemplates } = await tsImport(
  "../../packages/ui/src/settings/automationTemplateCatalog.ts",
  {
    parentURL: import.meta.url,
    tsconfig: fileURLToPath(new URL("../../packages/ui/tsconfig.json", import.meta.url)),
  },
);
const { mapClientScenesToDraftSuggestedPromptItems } = await tsImport(
  "../../packages/ui/src/v4/draftSuggestedPromptItems.ts",
  import.meta.url,
);
const item = (id, extra = {}) => ({
  id,
  labels: { en: id },
  contents: { en: "Fixture instructions" },
  ...extra,
});

test("retired idle scenes cannot enter the local automation template catalog", () => {
  const catalog = mapClientScenesToAutomationTemplates(
    [
      { scene: "off-peak-task", options: { prompts: { items: [item("idle-template")] } } },
      {
        scene: "scheduled-task",
        options: {
          prompts: { items: [item("scheduled-template", { defaults: { cronExpr: ["daily"] } })] },
          cronExpr: { items: [item("daily", { contents: { en: "0 9 * * *" } })] },
        },
      },
    ],
    () => true,
  );
  assert.equal(Object.hasOwn(catalog, "offPeak"), false);
  assert.deepEqual(
    catalog.scheduled.map(({ id }) => id),
    ["scheduled-template"],
  );
});

test("retired navigation recommendations are omitted, never converted into model prompts", () => {
  const result = mapClientScenesToDraftSuggestedPromptItems([
    {
      scene: "draft-suggestion",
      options: {
        prompts: {
          items: [
            item("old-idle", { on_finish: " NAVIGATE:AUTOMATIONS:OFFPEAK " }),
            item("mixed-idle", { on_finish: "NAVIGATE:AUTOMATIONS,NAVIGATE:AUTOMATIONS:OFFPEAK" }),
            item("scheduled", { on_finish: "NAVIGATE:AUTOMATIONS" }),
            item("plain"),
          ],
        },
      },
    },
  ]);
  assert.deepEqual(
    result.map(({ id }) => id),
    ["scheduled", "plain"],
  );
  assert.deepEqual(result[0].actions, ["NAVIGATE:AUTOMATIONS"]);
  assert.equal(result[1].prompt.en, "Fixture instructions");
});
