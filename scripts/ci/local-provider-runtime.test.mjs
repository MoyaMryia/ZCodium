import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tsImport } from "tsx/esm/api";

const { createProviderConfigRuntime, createProviderRuntimeFromConfigRuntime } = await tsImport(
  "./fixtures/personal-provider-provisioning.ts",
  import.meta.url,
);

async function setup(t) {
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Local model configuration must not initiate a network request");
  });
  t.after(() => assert.equal(fetch.mock.callCount(), 0));
  const dir = await mkdtemp(join(tmpdir(), "zcodium-local-provider-"));
  const configRuntime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: resolve(import.meta.dirname, "../../config/provider/zcode-builtin.json"),
    personalFilePath: join(dir, "personal.json"),
    personalPollingIntervalMs: false,
    watch: false,
  });
  t.after(async () => {
    configRuntime.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const runtime = createProviderRuntimeFromConfigRuntime(
    new Proxy(
      { configRuntime },
      {
        get(target, key) {
          assert.ok(
            key !== "accountSource" && key !== "disposeAccountSource",
            "Host must not access an official account lifecycle dependency",
          );
          return target[key];
        },
      },
    ),
  );
  t.after(() => runtime.dispose());
  return { runtime, configRuntime };
}

test("Host startup and repeated settings refresh read local facts without an account lifecycle", async (t) => {
  const { runtime } = await setup(t);
  await Promise.all([runtime.start(), runtime.start()]);
  for (const reason of ["open-settings", "user-retry", "local-config-changed"]) {
    await runtime.providerSettings.refresh(reason);
    const selection = await runtime.modelSelection.getView();
    for (const provider of selection.providers)
      assert.notEqual(provider.config.access.type, "zhipu-account");
  }
  const snapshot = runtime.registryService.getSnapshot();
  const accounts = snapshot.resolution.resolvedProviders.filter(
    (provider) => provider.config.access?.type === "zhipu-account",
  );
  assert.ok(accounts.length > 0, "fixture contains legacy builtin account entries");
  assert.ok(accounts.every((provider) => provider.models.every((model) => !model.executable)));
});

test("personal model creation, invalid edits, recovery and deletion stay usable without login", async (t) => {
  const { runtime } = await setup(t);
  const settings = runtime.providerSettings;
  const { providerId } = await settings.createPersonalProvider({ providerName: "Local fixture" });
  const config = {
    group: "standard-personal",
    api: { type: "openai-chat-completions", baseUrl: "https://api.example.invalid/v1" },
    access: { type: "api-key", apiKey: "fixture-user-key" },
  };
  await settings.savePersonalProviderOverlay(providerId, config);
  await settings.addPersonalModel(providerId, "fixture-model", { enabled: true }, true);
  const selection = {
    providerId,
    modelId: "fixture-model",
    options: { reasoningLevel: "disabled" },
  };
  assert.equal(runtime.registryService.validateSelection(selection).ok, true);
  await settings.savePersonalProviderOverlay(providerId, {
    ...config,
    access: { type: "api-key", apiKey: "" },
  });
  assert.equal(runtime.registryService.validateSelection(selection).ok, false);
  await settings.savePersonalProviderOverlay(providerId, config);
  assert.equal(runtime.registryService.validateSelection(selection).ok, true);
  await settings.refresh("user-retry");
  assert.equal(runtime.registryService.validateSelection(selection).ok, true);
  await settings.deletePersonalProvider(providerId);
  assert.equal(runtime.registryService.validateSelection(selection).ok, false);
});
