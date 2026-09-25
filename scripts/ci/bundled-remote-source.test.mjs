import assert from "node:assert/strict";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { bundleRemoteAssets } from "../bundle-remote-assets.mjs";
import { createRemoteAssetFixture, version } from "./remoteAssetsFixture.mjs";
const { BundledRemoteSource } = await tsImport(
  "../../packages/server/src/remote/bundledRemoteSource.ts",
  import.meta.url,
);

async function fixture(t, signal) {
  const data = await createRemoteAssetFixture(t);
  await bundleRemoteAssets(data.options);
  const source = new BundledRemoteSource({
    directory: data.options.outputDirectory,
    appVersion: version,
    platformArch: "linux-x64",
    temporaryRoot: data.root,
    signal,
  });
  t.after(() => source.dispose());
  return { ...data, source };
}

test("local-only source pins identity, materializes once per transaction and cleans up", async (t) => {
  const { source } = await fixture(t);
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network forbidden");
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  const manifest = await source.getManifest();
  assert.equal(manifest.components.length, 7);
  const [a, b] = await Promise.all([source.resolveReleaseDir(), source.resolveReleaseDir()]);
  assert.equal(a, b);
  assert.equal(
    await readFile(join(a, "glm/linux-x64/packages/node-repl-host/dist/mcp/server.js"), "utf8"),
    "fixture",
  );
  if (process.platform !== "win32")
    assert.ok((await stat(join(a, "node/linux-x64/node"))).mode & 0o111);
  await source.dispose();
  await assert.rejects(stat(a), { code: "ENOENT" });
  await assert.rejects(source.resolveReleaseDir(), /disposed/);
});

test("unsupported targets and missing bundles fail before remote use without fallback", async () => {
  assert.throws(
    () =>
      new BundledRemoteSource({
        directory: "/unused",
        appVersion: version,
        platformArch: "darwin-x64",
      }),
    /Unsupported/,
  );
  const source = new BundledRemoteSource({
    directory: "/missing-bundle-fixture",
    appVersion: version,
    platformArch: "linux-x64",
  });
  await assert.rejects(source.getManifest());
  await source.dispose();
});

test("archives changed after manifest admission are rejected and staging is removed", async (t) => {
  const { source, options, manifest, root } = await fixture(t);
  await source.getManifest();
  await writeFile(join(options.outputDirectory, manifest.components[0].artifactPath), "tampered");
  await assert.rejects(source.resolveReleaseDir(), /SHA256 mismatch/);
  assert.ok(!(await readdir(root)).some((name) => name.startsWith("zcodium-remote-")));
});

test("cancelled transactions do not materialize or fall back to old caches", async (t) => {
  const controller = new AbortController();
  const { source, root } = await fixture(t, controller.signal);
  controller.abort();
  await assert.rejects(source.resolveReleaseDir(), { name: "AbortError" });
  assert.ok(!(await readdir(root)).some((name) => name.startsWith("zcodium-remote-")));
});
