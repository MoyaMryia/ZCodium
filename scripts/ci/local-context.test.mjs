import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { loadComponentCallback } from "./fixtures/component-callback.mjs";
const toolbar = "packages/ui/src/v4/composer/V4ComposerToolbar.tsx";

test("composer context display has no official account, quota, or settings read dependencies", async () => {
  for (const path of [toolbar, "packages/ui/src/chat-input-toolbar/contextUsage.tsx"]) {
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = source.statements
      .filter(ts.isImportDeclaration)
      .map((node) => node.getText(source))
      .join("\n");
    assert.doesNotMatch(
      imports,
      /CodingPlan|codingPlan|StartPlan|startPlan|[Uu]sageEntitlement|useProviderSettingsView|useSettings|AccountAccess|accountProviderAccess|contextQuota/,
    );
  }
});

test("model selection retains Composer source identity and existing custom provider recovery", async () => {
  for (const recover of [false, true]) {
    const selections = [],
      recoveries = [],
      pending = [];
    let complete;
    const recovery = new Promise((resolve) => {
      complete = resolve;
    });
    const source = { provider: "fixture-source", model: "old-model" };
    const callback = await loadComponentCallback(toolbar, "handleModelValueChange", {
      decodeCustomModelValue: () => ({ providerId: "fixture-api", modelName: "new-model" }),
      effectiveConfig: source,
      logger: { debug() {}, warn() {} },
      draftMode: true,
      modelSelectionView: {
        providers: [{ providerId: "fixture-api", config: { access: { type: "api-key" } } }],
      },
      isApiKeyAccess: (access) => access?.type === "api-key",
      configOptionsError: recover ? new Error("Fixture unavailable config") : null,
      onRecoverCustomModelSelection: (...args) => {
        recoveries.push(args);
        return recovery;
      },
      onSelectModel: (...args) => selections.push(args),
      setRecoveryPending: (value) => pending.push(value),
    });
    callback("fixture-selection");
    if (recover) {
      assert.deepEqual(recoveries, [["fixture-selection", source]]);
      assert.deepEqual(pending, [true]);
      complete();
      await recovery;
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(pending, [true, false]);
      assert.deepEqual(selections, []);
    } else assert.deepEqual(selections, [["fixture-api", "new-model", source]]);
  }
});
