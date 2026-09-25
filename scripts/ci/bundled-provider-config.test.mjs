import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tsImport } from "tsx/esm/api";

const { NodeZCodeBuiltinProviderConfigSource, NodeProviderConfigRuntime } = await tsImport(
  "../../packages/provider-node/src/index.ts",
  import.meta.url,
);
const { prepareCliProviderRuntimeEnv } = await tsImport(
  "../../apps/zcode-cli/packages/cli/src/provider-runtime-env.ts",
  import.meta.url,
);
const bundled = JSON.parse(
  await readFile(new URL("../../config/provider/zcode-builtin.json", import.meta.url), "utf8"),
);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "zcodium-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, "bundle.json");
  const active = join(root, "old-cache.json");
  await writeFile(file, JSON.stringify(bundled));
  await writeFile(active, JSON.stringify({ ...bundled, revision: 999999 }));
  const source = new NodeZCodeBuiltinProviderConfigSource({
    bundledFilePath: file,
    activeFilePath: active,
    watch: false,
  });
  t.after(() => source.dispose());
  return { root, file, active, source };
}

test("builtin reads only bundled content and never repairs or trusts old downloaded caches", async (t) => {
  const { root, file, active, source } = await fixture(t);
  const before = await readFile(active, "utf8");
  const files = await readdir(root);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network forbidden");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const snapshot = await source.read();
  assert.match(snapshot.revision, new RegExp(`^zcode-builtin:${bundled.revision}:`));
  assert.deepEqual(await readdir(root), files);
  assert.equal(await readFile(active, "utf8"), before);
  await writeFile(file, "invalid bundle");
  await assert.rejects(source.read());
  assert.equal(await readFile(active, "utf8"), before);
});

test("Host and Worker share content identity; same release number with new content invalidates it", async (t) => {
  const { file, source } = await fixture(t);
  const worker = new NodeZCodeBuiltinProviderConfigSource({ bundledFilePath: file, watch: false });
  t.after(() => worker.dispose());
  const original = await source.read();
  assert.equal((await worker.read()).revision, original.revision);
  const changed = structuredClone(bundled);
  changed.config.providerConfigRules.templateRules[0].templateNameMap["en-US"] += " revised";
  await writeFile(file, JSON.stringify(changed));
  const next = await source.read();
  assert.notEqual(next.revision, original.revision);
  assert.equal((await worker.read()).revision, next.revision);
});

test(
  "local runtime retains cross-process personal changes and dependency recovery callbacks",
  { timeout: 5000 },
  async (t) => {
    const { root, file } = await fixture(t);
    const options = {
      zcodeBuiltinFilePath: file,
      personalFilePath: join(root, "personal.json"),
      personalPollingIntervalMs: 20,
      watch: false,
    };
    const host = new NodeProviderConfigRuntime(options);
    const worker = new NodeProviderConfigRuntime(options);
    t.after(() => {
      host.dispose();
      worker.dispose();
    });
    const recovery = new Promise((resolve) => host.onDidCheckConfig(async () => resolve()));
    await Promise.all([host.start(), worker.start()]);
    await recovery;
    const before = await worker.configService.read();
    const changed = new Promise((resolve) =>
      worker.configService.onDidChange((reason) => {
        if (reason.startsWith("personal:")) resolve();
      }),
    );
    await host.configService.createPersonalProvider({ providerName: "My local provider" });
    await changed;
    const after = await worker.configService.read();
    assert.notEqual(after.personalRevision, before.personalRevision);
    assert.equal(after.zcodeBuiltinRevision, before.zcodeBuiltinRevision);
    assert.equal([...after.personalProviders.entries()].length, 1);
  },
);

test("standalone CLI points to packaged config while managed CLI retains Host paths", async (t) => {
  const { root, file } = await fixture(t);
  const dir = join(root, "cli");
  await mkdir(join(dir, "provider"), { recursive: true });
  await writeFile(join(dir, "entry.js"), "");
  const local = join(dir, "provider", "zcode-builtin.json");
  await writeFile(local, JSON.stringify(bundled));
  const env = await prepareCliProviderRuntimeEnv({
    argv: ["--prompt", "test"],
    env: {},
    dataBaseDir: root,
    entrypoint: join(dir, "entry.js"),
    sea: { isSea: () => false },
  });
  assert.equal(env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE, local);
  assert.equal(env.ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE, undefined);
  const managed = {
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: file,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(root, "host-personal.json"),
  };
  assert.deepEqual(
    await prepareCliProviderRuntimeEnv({ argv: ["app-server"], env: managed }),
    managed,
  );
});

test(
  "atomic bundle replacement emits a local change and keeps Host/Worker revisions aligned",
  { timeout: 5000 },
  async (t) => {
    const { root, file, source } = await fixture(t);
    const watched = new NodeZCodeBuiltinProviderConfigSource({ bundledFilePath: file });
    t.after(() => watched.dispose());
    const before = await watched.read();
    const changed = new Promise((resolve) =>
      watched.onDidChange((reason) => {
        if (reason === "file-changed") resolve();
      }),
    );
    const next = structuredClone(bundled);
    next.config.providerConfigRules.templateRules[0].templateNameMap["en-US"] += " new";
    const staging = join(root, "next.json");
    await writeFile(staging, JSON.stringify(next));
    const { rename } = await import("node:fs/promises");
    await rename(staging, file);
    await changed;
    assert.notEqual((await watched.read()).revision, before.revision);
    assert.equal((await watched.read()).revision, (await source.read()).revision);
  },
);

test("SEA entry materializes its embedded config without using an endpoint cache", async (t) => {
  const { root } = await fixture(t);
  const env = await prepareCliProviderRuntimeEnv({
    argv: ["tui"],
    env: {},
    dataBaseDir: root,
    sea: {
      isSea: () => true,
      getAsset(key, encoding) {
        assert.equal(key, "zcode-provider/zcode-builtin.json");
        assert.equal(encoding, "utf8");
        return JSON.stringify(bundled);
      },
    },
  });
  assert.equal(
    env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,
    join(root, ".zcodium", "v2", "runtime", "provider", "bundled", "zcode-builtin.json"),
  );
  const source = new NodeZCodeBuiltinProviderConfigSource({
    bundledFilePath: env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE,
    watch: false,
  });
  t.after(() => source.dispose());
  assert.match((await source.read()).revision, new RegExp(`^zcode-builtin:${bundled.revision}:`));
});
