import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tsImport } from "tsx/esm/api";

const { startProcessProviderRegistryRuntime, decodeProviderConfigFile, ZCodeProtocolAgentServer } =
  await tsImport("./fixtures/cli-local-provider.ts", import.meta.url);
const config = (apiKey = "fixture-user-key") => ({
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [
        {
          providerId: "fixture-api",
          providerName: "User API",
          enabled: true,
          config: {
            group: "standard-personal",
            api: { type: "openai-chat-completions", baseUrl: "https://api.example.invalid/v1" },
            access: { type: "api-key", apiKey },
            personalModelIds: ["fixture-model"],
            modelOrder: ["fixture-model"],
          },
        },
      ],
    },
    modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
    providerOrder: ["fixture-api"],
    defaultModelSelection: {
      providerId: "fixture-api",
      modelId: "fixture-model",
      options: { reasoningLevel: "disabled" },
    },
  },
});

for (const standalone of [true, false]) {
  test(`${standalone ? "Standalone CLI" : "Managed Agent"} keeps personal models usable without account credentials or overlay sync`, async (t) => {
    const fetch = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("Unexpected network request");
    });
    const dir = await mkdtemp(join(tmpdir(), "zcodium-cli-local-provider-"));
    const builtinPath = join(dir, "builtin.json");
    const personalPath = join(dir, "personal.json");
    const builtin = JSON.parse(
      await readFile(
        resolve(import.meta.dirname, "../../config/provider/zcode-builtin.json"),
        "utf8",
      ),
    );
    await writeFile(builtinPath, JSON.stringify(builtin));
    await writeFile(personalPath, JSON.stringify(config()));
    let owner;
    t.after(async () => {
      owner?.dispose();
      await rm(dir, { recursive: true, force: true });
      assert.equal(fetch.mock.callCount(), 0);
    });
    const options = standalone
      ? {
          standalone: new Proxy(
            {},
            {
              get(_, key) {
                assert.ok(
                  !["credentialStore", "onAccountInitializationError"].includes(key),
                  `Must not read retired ${String(key)}`,
                );
                return undefined;
              },
            },
          ),
        }
      : {};
    owner = await startProcessProviderRegistryRuntime(
      {
        ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinPath,
        ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
      },
      options,
    );
    const registry = owner.runtime.registryService;
    const selection = config().config.defaultModelSelection;
    assert.equal(registry.validateSelection(selection).ok, true);
    const accounts = registry
      .getSnapshot()
      .resolution.resolvedProviders.filter(
        (provider) => provider.config.access?.type === "zhipu-account",
      );
    assert.ok(accounts.length > 0);
    assert.ok(accounts.every((provider) => provider.models.every((model) => !model.executable)));
    assert.equal(owner.providerRuntimeHeadersPort, undefined);
    assert.equal(owner.syncAccountProviderConfig, undefined);
    assert.equal(owner.accountSource, undefined);

    for (const [key, executable] of [
      ["", false],
      ["fixture-replacement", true],
    ]) {
      await owner.runtime.configService.replacePersonalConfig(
        decodeProviderConfigFile(config(key)),
      );
      await registry.refresh("personal-edit");
      assert.equal(registry.validateSelection(selection).ok, executable);
    }
    const previous = registry.getSnapshot().config.zcodeBuiltinRevision;
    builtin.revision += 1;
    await writeFile(builtinPath, JSON.stringify(builtin));
    await registry.refresh("builtin-release-changed");
    assert.notEqual(registry.getSnapshot().config.zcodeBuiltinRevision, previous);
    assert.equal(registry.validateSelection(selection).ok, true);
    assert.deepEqual(
      await owner.modelSelectionConfigRepository.read(),
      config().config.defaultModelSelection,
    );
  });
}

test("Agent rejects retired Host account configuration instead of acknowledging entitlement changes", async () => {
  let writes = 0;
  const server = new ZCodeProtocolAgentServer({
    createZCodeApp: async () => {
      throw new Error("Account config must not create an app");
    },
    syncAccountProviderConfig: async () => {
      writes += 1;
      return true;
    },
  });
  try {
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: "retired-account-config",
      method: "provider/updateAccountConfig",
      params: {
        revision: "fixture-account",
        basedOnZCodeBuiltinRevision: "fixture-builtin",
        providers: {},
        states: {},
      },
    });
    assert.equal(response.error?.code, -32601);
    assert.equal(response.id, "retired-account-config");
    assert.equal(writes, 0);
  } finally {
    await server.shutdown();
  }
});
