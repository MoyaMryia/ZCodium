// Exercise the actual store UI and Zustand owner; observe service calls without running plugins.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/bundled-plugin-marketplace.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".png": "dataurl", ".svg": "dataurl", ".css": "empty" },
  outdir: resolve(tmpdir(), "zcodium-marketplace-browser"),
  define: { "process.env.NODE_ENV": '"production"' },
});
const assets =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const cssName = (await readdir(assets)).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "Build desktop CSS before catalog browser checks");
const css = await readFile(resolve(assets, cssName));
const server = createServer(async (request, response) => {
  if (/\.(?:woff2?|ttf)$/.test(request.url)) {
    try {
      response.setHeader("Content-Type", "application/octet-stream");
      response.end(await readFile(resolve(assets, basename(request.url))));
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  if (request.url === "/style.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
    return;
  }
  response.setHeader(
    "Content-Type",
    request.url === "/fixture.js" ? "text/javascript" : "text/html",
  );
  response.end(
    request.url === "/fixture.js"
      ? outputFiles.find((file) => file.path.endsWith(".js")).contents
      : '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><style>html,body,#root {height:auto;overflow:visible} body {background:var(--color-background)!important} #root {padding:12px;max-width:640px;margin:auto} output {overflow-wrap:anywhere}</style><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/fixture.js"></script>',
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
  page.setDefaultTimeout(10000);
  for (const locale of ["en-US", "zh-CN"])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}`);
      await page.evaluate((dark) => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.classList.toggle("theme-zai-dark", dark);
        document.documentElement.classList.toggle("theme-zai-light", !dark);
      }, width === 1280);
      await page
        .locator(
          '[data-testid="plugin-store-card"][data-plugin-id="browser-use@zcode-plugins-official"]',
        )
        .waitFor();
      const settle = async () =>
        page.evaluate(async () => {
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
      await settle();
      assert.deepEqual(await page.evaluate(() => window.marketplaceFixture.updates), []);
      const browserCard = page.locator(
        '[data-testid="plugin-store-card"][data-plugin-id="browser-use@zcode-plugins-official"]',
      );
      assert.equal(await browserCard.locator("img").count(), 0);
      assert.ok((await browserCard.locator("svg").count()) > 0);
      await page
        .locator('[data-plugin-id="documents@zcode-plugins-official"] img')
        .evaluate(async (img) => {
          await img.decode();
          assertImage(img);
          function assertImage(img) {
            if (!img.naturalWidth) throw new Error("Missing bundled icon");
          }
        });
      await browserCard.focus();
      await page.keyboard.press("Enter");
      await page.locator('[data-testid="plugin-store-root"][data-view="detail"]').waitFor();
      await page.waitForFunction(() => window.marketplaceFixture.descriptions.length === 1);
      await page.getByTestId("toggle-store").click();
      await page.getByTestId("toggle-store").click();
      await page.getByTestId("plugin-store-refresh").waitFor();
      await settle();
      assert.deepEqual(await page.evaluate(() => window.marketplaceFixture.updates), []);
      await page.getByTestId("plugin-store-refresh").click();
      await page.waitForFunction(() => window.marketplaceFixture.updates.length === 1);
      assert.deepEqual(await page.evaluate(() => window.marketplaceFixture.updates), ["all"]);
      await page.getByTestId("plugin-store-sources-open").click();
      await page.getByTestId("plugin-store-sources-dialog").waitFor();
      const bundledRow = page.locator(
        '[data-testid="plugin-store-source-row"][data-marketplace-id="zcode-plugins-official"]',
      );
      assert.equal(await bundledRow.getByTestId("plugin-store-source-remove").count(), 0);
      await page
        .locator(
          '[data-testid="plugin-store-source-update"][data-marketplace-id="personal-fixture"]',
        )
        .click();
      await page.waitForFunction(() => window.marketplaceFixture.updates.length === 2);
      assert.deepEqual(await page.evaluate(() => window.marketplaceFixture.updates), [
        "all",
        "personal-fixture",
      ]);
      await page.screenshot({
        path: resolve(tmpdir(), `zcodium-bundled-marketplace-sources-${locale}-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Escape");
      await page.getByTestId("plugin-store-sources-dialog").waitFor({ state: "hidden" });
      await page
        .getByText(
          locale === "zh-CN" ? "所有已安装插件已是最新" : "All installed plugins are up to date",
          { exact: true },
        )
        .first()
        .waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: resolve(tmpdir(), `zcodium-bundled-marketplace-${locale}-${width}.png`),
        fullPage: true,
      });
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(
    "Bundled marketplace browser smoke passed: no entry/remount auto refresh, manual refresh, keyboard detail navigation, local icons, personal sources, no external requests",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
