import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

test("Web entry no longer packages official login, profile storage or token exchange", async () => {
  const result = await build({
    entryPoints: [resolve(import.meta.dirname, "../../packages/web/src/main.tsx")],
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    external: ["@zcode/*"],
    define: { "import.meta.env": "{}" },
  });
  assert.deepEqual(
    Object.keys(result.metafile.inputs).filter((file) => file.includes("packages/web/src/auth/")),
    [],
  );
  const code = result.outputFiles[0].text;
  assert.doesNotMatch(
    code,
    /startLogin|exchangeToken|saveUserInfo|oauth_pending|client_P8X5CMWmlaRO9gyO-KSqtg/,
  );
  const config = await readFile(
    new URL("../../packages/web/vite.config.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(config, /\/api\/v1\/oauth\/token|VITE_ZAI_OAUTH|resolveZaiOAuth/);
  assert.match(config, /"\/ws": \{ target: "ws:\/\/localhost:3030", ws: true \}/);
  assert.match(config, /"\/api": \{ target: "http:\/\/localhost:3030" \}/);
  const html = await readFile(new URL("../../packages/web/index.html", import.meta.url), "utf8");
  assert.match(html, /name="referrer" content="no-referrer"/);
});
