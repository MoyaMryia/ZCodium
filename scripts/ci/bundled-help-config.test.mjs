import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { tsImport } from "tsx/esm/api";

const { resolveHelpAppConfig } = await tsImport(
  "../../packages/shared/src/helpAppConfig.ts",
  import.meta.url,
);
const { readDesktopHelpConfig } = await tsImport(
  "../../packages/desktop/src/main/desktopHelpConfig.ts",
  import.meta.url,
);
const { resolveWebHelpConfig, resolveWebCommunityUrl } = await tsImport(
  "../../packages/web/src/communityUrl.ts",
  import.meta.url,
);
const { resolveZCodeAgentPresentationSurface } = await tsImport(
  "../../packages/services/src/zcode-agent/zcodeAgentPresentationSurface.ts",
  import.meta.url,
);
const bundled = JSON.parse(
  await readFile(new URL("../../config/default.json", import.meta.url), "utf8"),
);

test("help config is local, validates link protocols and preserves locale boundaries", () => {
  const local = resolveHelpAppConfig({
    community_urls: { "en-US": "https://example.com/community", "zh-CN": "javascript:alert(1)" },
    feedback_url: "file:///tmp/feedback",
    feedback_use_external_form: true,
  });
  assert.equal(local.community_urls["en-US"], "https://example.com/community");
  assert.equal(local.community_urls["zh-CN"], undefined);
  assert.equal(local.feedback_url, undefined);
  assert.equal(resolveHelpAppConfig({ feedback_url: "invalid url" }).feedback_url, undefined);
  assert.equal(resolveHelpAppConfig(undefined).feedback_use_external_form, true);
});

test("Desktop packaged/development and Web help use the same bundled links without requests", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zcodium-help-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("help network forbidden");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const resources = join(root, "resources");
  await mkdir(join(resources, "config"), { recursive: true });
  await mkdir(join(root, "config"), { recursive: true });
  await writeFile(join(resources, "config/default.json"), JSON.stringify(bundled));
  await writeFile(join(root, "config/default.json"), JSON.stringify(bundled));
  const expected = resolveHelpAppConfig(bundled);
  assert.deepEqual(
    await readDesktopHelpConfig({
      isPackaged: true,
      appPath: join(resources, "app.asar"),
      resourcesPath: resources,
    }),
    expected,
  );
  assert.deepEqual(
    await readDesktopHelpConfig({
      isPackaged: false,
      appPath: join(root, "packages/desktop"),
      resourcesPath: resources,
    }),
    expected,
  );
  assert.deepEqual(await resolveWebHelpConfig(), expected);
  assert.equal(expected.feedback_url, "https://github.com/axiom-desu/ZCodium/issues/new");
  assert.equal(expected.feedback_use_external_form, true);
  for (const locale of ["en-US", "zh-CN"]) {
    assert.equal(await resolveWebCommunityUrl(locale), "https://github.com/axiom-desu/ZCodium");
  }
  await writeFile(join(resources, "config/default.json"), "malformed");
  await assert.rejects(
    readDesktopHelpConfig({ isPackaged: true, appPath: "unused", resourcesPath: resources }),
  );
});

test("desktop prompt is derived from Host facts with a local opt-out, never enabled on manual servers", () => {
  assert.equal(
    resolveZCodeAgentPresentationSurface({ runtimeSurface: "desktop_local_host" }),
    "desktop",
  );
  assert.equal(
    resolveZCodeAgentPresentationSurface({ serviceAuthorityMode: "desktop-attached-remote" }),
    "desktop",
  );
  assert.equal(
    resolveZCodeAgentPresentationSurface({
      runtimeSurface: "desktop_local_host",
      desktopContextPromptEnabled: false,
    }),
    undefined,
  );
  assert.equal(
    resolveZCodeAgentPresentationSurface({ runtimeSurface: "remote_workspace_host" }),
    undefined,
  );
  assert.equal(
    resolveZCodeAgentPresentationSurface({ desktopContextPromptEnabled: true }),
    undefined,
  );
});
