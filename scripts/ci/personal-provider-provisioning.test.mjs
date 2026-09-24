import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { tsImport } from "tsx/esm/api";

const {
  createProviderProvisioningSource,
  createProviderProvisioningTarget,
  createProviderConfigRuntime,
  createProviderRuntimeFromConfigRuntime,
  decodeProviderConfigFile,
  encodeProviderConfigFile,
  NodePersonalProviderConfigRepository,
  providerProvisioningEnvelopeSchema,
  providerProvisioningTriggerSchema,
} = await tsImport("./fixtures/personal-provider-provisioning.ts", import.meta.url);

const config = (name = "Fixture API") => ({
  providerConfigRules: {
    providerRules: [
      {
        providerId: "fixture-api",
        providerName: name,
        enabled: true,
        config: {
          group: "standard-personal",
          api: { type: "openai-chat-completions", baseUrl: "https://api.example.invalid/v1" },
          access: { type: "api-key", apiKey: "fixture-user-supplied-key" },
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
});
const decode = (value) => decodeProviderConfigFile({ schemaVersion: 1, config: value });
const guarded = (options) =>
  new Proxy(options, {
    get(target, key) {
      assert.ok(key in target, `Provisioning must not access retired dependency: ${String(key)}`);
      return target[key];
    },
  });

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), "zcodium-personal-sync-"));
  const sourcePath = join(dir, "source.json");
  const targetPath = join(dir, "target.json");
  const statePath = join(dir, "state.json");
  const repository = new NodePersonalProviderConfigRepository({
    filePath: sourcePath,
    pollingIntervalMs: false,
  });
  await repository.update(() => decode(config()));
  const configRuntime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: resolve(import.meta.dirname, "../../config/provider/zcode-builtin.json"),
    personalFilePath: targetPath,
    personalPollingIntervalMs: false,
    watch: false,
    readLegacyProviders: async () => [],
  });
  const runtime = createProviderRuntimeFromConfigRuntime({ configRuntime });
  t.after(async () => {
    runtime.dispose();
    repository.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const sourceOptions = guarded({
    personalRepository: repository,
    personalConfigFilePath: sourcePath,
  });
  const source = createProviderProvisioningSource(sourceOptions);
  const targetOptions = guarded({
    providerRuntime: runtime,
    personalRepository: configRuntime.personalRepository,
    personalConfigFilePath: targetPath,
    stateFilePath: statePath,
  });
  const target = createProviderProvisioningTarget(targetOptions);
  return {
    dir,
    source,
    target,
    sourceOptions,
    targetOptions,
    repository,
    sourcePath,
    targetPath,
    statePath,
    configRuntime,
    runtime,
  };
}

test("only personal model configuration crosses environments; credentials/settings are not accessed", async (t) => {
  const f = await setup(t);
  await writeFile(
    join(f.dir, "credentials.json"),
    '{"oauth:zai:user_info":"fixture-private-profile","oauth:zai:access_token":"fixture-token"}',
  );
  const envelope = await f.source.read("sync-fixture");
  assert.deepEqual(Object.keys(envelope).sort(), ["personalConfig", "schemaVersion", "syncId"]);
  assert.equal(envelope.schemaVersion, 2);
  assert.ok(!JSON.stringify(envelope).includes("fixture-private-profile"));
  assert.deepEqual(
    envelope.personalConfig,
    encodeProviderConfigFile(await f.repository.read()).config,
  );
  const result = await f.target.apply(envelope);
  assert.equal(result.status, "applied", result.errorMessage);
  assert.ok(!("credentialCount" in result));
  const actual = JSON.parse(await readFile(f.targetPath, "utf8"));
  assert.equal(
    actual.config.providerConfigRules.providerRules[0].config.access.apiKey,
    "fixture-user-supplied-key",
  );
  assert.deepEqual(actual.config.providerOrder, ["fixture-api"]);
  assert.deepEqual(actual.config.defaultModelSelection, config().defaultModelSelection);
  assert.ok(f.runtime.registryService.validateSelection(config().defaultModelSelection).ok);
});

test("old account envelopes and retired account triggers are rejected before IO", async (t) => {
  const f = await setup(t);
  const envelope = await f.source.read("sync-invalid");
  for (const bad of [
    { ...envelope, schemaVersion: 1 },
    { ...envelope, credentials: [] },
    {
      ...envelope,
      accountSettings: { providerFamilyDomain: "zai", providerFamilyConnectionSelections: {} },
    },
  ]) {
    assert.equal(providerProvisioningEnvelopeSchema.safeParse(bad).success, false);
    const target = createProviderProvisioningTarget(
      new Proxy(
        {},
        {
          get: () => {
            throw new Error("No IO allowed for invalid envelope");
          },
        },
      ),
    );
    await assert.rejects(target.apply(bad), (error) => !String(error).includes("No IO allowed"));
  }
  assert.equal(providerProvisioningTriggerSchema.safeParse("credential").success, false);
  assert.equal(providerProvisioningTriggerSchema.safeParse("account-settings").success, false);
  await assert.rejects(readFile(f.targetPath), { code: "ENOENT" });
});

test("duplicate concurrent delivery applies personal config once and preserves later user edits", async (t) => {
  const f = await setup(t);
  const envelope = await f.source.read("sync-duplicate");
  const results = await Promise.all([f.target.apply(envelope), f.target.apply(envelope)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["already-applied", "applied"]);
  await f.configRuntime.personalRepository.update(() => decode(config("Later local edit")));
  assert.equal((await f.target.apply(envelope)).status, "already-applied");
  assert.equal(
    JSON.parse(await readFile(f.targetPath, "utf8")).config.providerConfigRules.providerRules[0]
      .providerName,
    "Later local edit",
  );
});

test("corrupt Personal file cannot export an empty in-memory recovery as authoritative config", async (t) => {
  const f = await setup(t);
  await writeFile(f.sourcePath, '{"broken":');
  await assert.rejects(f.source.read("sync-corrupt"), /Personal Provider Config/);
});

for (const concurrentEdit of [false, true])
  test(`registry failure ${concurrentEdit ? "preserves concurrent user changes" : "rolls back personal configuration"}`, async (t) => {
    const f = await setup(t);
    await f.configRuntime.personalRepository.update(() => decode(config("Original target")));
    const refresh = f.runtime.registryService.refresh.bind(f.runtime.registryService);
    let failed = false;
    f.runtime.registryService.refresh = async (reason) => {
      if (reason === "provider-provisioning" && !failed) {
        failed = true;
        if (concurrentEdit)
          await f.configRuntime.personalRepository.update(() => decode(config("Concurrent edit")));
        throw new Error("Fixture registry failure");
      }
      return refresh(reason);
    };
    const result = await f.target.apply(await f.source.read("sync-rollback"));
    assert.equal(result.status, concurrentEdit ? "rollback_failed" : "failed");
    assert.equal(result.rolledBack, !concurrentEdit);
    assert.equal(
      JSON.parse(await readFile(f.targetPath, "utf8")).config.providerConfigRules.providerRules[0]
        .providerName,
      concurrentEdit ? "Concurrent edit" : "Original target",
    );
    assert.equal((await f.target.apply(await f.source.read("sync-retry"))).status, "applied");
  });

test("missing or concurrently changed source file cannot export a stale snapshot", async (t) => {
  const f = await setup(t);
  const snapshot = await f.repository.read();
  const source = createProviderProvisioningSource({
    personalRepository: { read: async () => snapshot },
    personalConfigFilePath: f.sourcePath,
  });
  await writeFile(
    f.sourcePath,
    JSON.stringify(encodeProviderConfigFile(decode(config("New edit")))),
  );
  await assert.rejects(source.read("sync-stale"), /Personal Provider Config/);
  await rm(f.sourcePath);
  await assert.rejects(source.read("sync-missing"), /Personal Provider Config/);
});

test("unsupported default selection rolls back the whole config and allows a corrected retry", async (t) => {
  const f = await setup(t);
  await f.configRuntime.personalRepository.update(() => decode(config("Original target")));
  const envelope = await f.source.read("sync-default");
  envelope.personalConfig.defaultModelSelection.modelId = "missing-model";
  const result = await f.target.apply(envelope);
  assert.equal(result.status, "failed");
  assert.equal(result.rolledBack, true);
  assert.equal(
    JSON.parse(await readFile(f.targetPath, "utf8")).config.providerConfigRules.providerRules[0]
      .providerName,
    "Original target",
  );
  assert.equal((await f.target.apply(await f.source.read("sync-default"))).status, "applied");
});

test("legacy receipt cannot falsely acknowledge a personal-only sync", async (t) => {
  const f = await setup(t);
  await writeFile(
    f.statePath,
    JSON.stringify({
      schemaVersion: 1,
      records: [
        {
          syncId: "same-id",
          result: {
            syncId: "same-id",
            status: "applied",
            personalProviderCount: 1,
            credentialCount: 2,
            rolledBack: false,
          },
        },
      ],
    }),
  );
  assert.equal((await f.target.apply(await f.source.read("same-id"))).status, "applied");
  const receipt = JSON.parse(await readFile(f.statePath, "utf8"));
  assert.equal(receipt.schemaVersion, 2);
  assert.ok(!JSON.stringify(receipt).includes("credentialCount"));
});

test("receipt write failure restores config and does not suppress retry", async (t) => {
  const f = await setup(t);
  await f.configRuntime.personalRepository.update(() => decode(config("Original target")));
  const refresh = f.runtime.registryService.refresh.bind(f.runtime.registryService);
  let failReceipt = true;
  f.runtime.registryService.refresh = async (reason) => {
    const snapshot = await refresh(reason);
    if (reason === "provider-provisioning" && failReceipt) {
      failReceipt = false;
      await mkdir(f.statePath);
    }
    return snapshot;
  };
  const envelope = await f.source.read("sync-receipt");
  const result = await f.target.apply(envelope);
  assert.equal(result.status, "failed");
  assert.equal(result.rolledBack, true);
  assert.equal(
    JSON.parse(await readFile(f.targetPath, "utf8")).config.providerConfigRules.providerRules[0]
      .providerName,
    "Original target",
  );
  await rm(f.statePath, { recursive: true });
  assert.equal((await f.target.apply(envelope)).status, "applied");
});
