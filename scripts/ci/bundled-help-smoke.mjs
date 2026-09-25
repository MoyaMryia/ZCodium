// Browser integration for the production Web help resolver; external navigation is intercepted.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  stdin: {
    contents: `import { resolveWebHelpConfig, resolveWebCommunityUrl } from './packages/web/src/communityUrl.ts';
      window.help = { resolveWebHelpConfig, resolveWebCommunityUrl };`,
    resolveDir: root,
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
});
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? outputFiles[0].contents
      : '<!doctype html><script type="module" src="/fixture.js"></script>',
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ZCODE_TEST_CHROMIUM_EXECUTABLE || undefined,
  });
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.help));
  const help = await page.evaluate(async () => ({
    config: await window.help.resolveWebHelpConfig(),
    english: await window.help.resolveWebCommunityUrl("en-US"),
    chinese: await window.help.resolveWebCommunityUrl("zh-CN"),
  }));
  assert.equal(help.english, "https://github.com/axiom-desu/ZCodium");
  assert.equal(help.chinese, help.english);
  assert.equal(help.config.feedback_url, "https://github.com/axiom-desu/ZCodium/issues/new");
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Bundled Web help browser check passed: both locales, feedback URL, zero external requests",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
