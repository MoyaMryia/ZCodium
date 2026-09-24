// Exercise the bundled catalog through actual UI hooks, recommendation buttons and template mapping.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/client-catalog.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  define: { "process.env.NODE_ENV": '"production"' },
});
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? outputFiles[0].contents
      : '<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script type="module" src="/fixture.js"></script>',
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const externalRequests = [];
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  for (const locale of ["en-US", "zh-CN"]) {
    await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}`);
    await page
      .getByRole("button", {
        name: locale === "en-US" ? "Explore this project" : "了解这个项目",
        exact: true,
      })
      .click();
    const selected = JSON.parse(await page.getByTestId("selected").textContent());
    assert.ok(
      selected.prompt.startsWith(locale === "en-US" ? "Read this project" : "阅读当前项目"),
    );
    await page.getByTestId("template-morning-git-summary").click();
    const draft = JSON.parse(await page.getByTestId("selected").textContent());
    assert.equal(draft.cronExpr, "0 9 * * 1-5");
    assert.ok(draft.title && draft.prompt);
    assert.equal(await page.evaluate(() => window.catalogReadCount), 1);
    await page.evaluate(async () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    assert.equal(await page.evaluate(() => window.catalogReadCount), 1);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(
    "Bundled catalog browser smoke passed: localized prompt/template selection, no background refresh or external requests",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
