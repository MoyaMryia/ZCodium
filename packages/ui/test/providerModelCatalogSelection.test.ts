import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDefaultCatalogSelection,
  resolveModelCatalogItems,
  summarizeCatalogAddResults,
} from "../src/settings/model-provider-section/providerModelCatalogSelection.js";

test("catalog items keep fetch order and flag already added models", () => {
  const items = resolveModelCatalogItems(["gpt-4o", "gpt-4o-mini", "gpt-4o"], ["gpt-4o-mini"]);
  assert.deepEqual(items, [
    { modelId: "gpt-4o", alreadyAdded: false },
    { modelId: "gpt-4o-mini", alreadyAdded: true },
  ]);
});

test("catalog items trim blanks and drop empty ids", () => {
  const items = resolveModelCatalogItems(["  m1  ", "", "   ", "m2"], []);
  assert.deepEqual(items, [
    { modelId: "m1", alreadyAdded: false },
    { modelId: "m2", alreadyAdded: false },
  ]);
});

test("default selection only pre-checks models that are not added yet", () => {
  const items = resolveModelCatalogItems(["a", "b", "c"], ["b"]);
  assert.deepEqual(resolveDefaultCatalogSelection(items), ["a", "c"]);
});

test("add result summary counts successes and failures", () => {
  assert.deepEqual(summarizeCatalogAddResults([true, true, false]), { added: 2, failed: 1 });
  assert.deepEqual(summarizeCatalogAddResults([]), { added: 0, failed: 0 });
});
