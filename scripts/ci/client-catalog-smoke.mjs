// Exercise the bundled catalog through actual UI hooks, recommendation buttons and template mapping.
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
  entryPoints: [resolve(import.meta.dirname, "fixtures/client-catalog.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".png": "dataurl" },
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
      ? outputFiles[0].contents
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
  for (const locale of ["en-US", "zh-CN"])
    for (const width of [390, 1280])
      for (const mode of ["office", "coding"]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}&mode=${mode}`);
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle("dark", dark);
          document.documentElement.classList.toggle("theme-zai-dark", dark);
          document.documentElement.classList.toggle("theme-zai-light", !dark);
        }, width === 1280);
        const items = await page.evaluate(() => window.featureItems);
        assert.ok(items.length > 5);
        for (const [index, item] of items.entries()) {
          assert.equal(item.mode, mode);
          const button = page.locator(`[data-draft-suggested-prompt="${item.id}"]`);
          await button.waitFor();
          if (item.iconUrl) {
            await button.locator("img").evaluate(async (img) => {
              await img.decode();
              if (!img.naturalWidth) throw new Error("Unresolved bundled recommendation image");
            });
          } else {
            await button.locator(`[data-client-scene-lucide-icon="${item.iconName}"]`).waitFor();
          }
          if (index % 2 === 0) {
            await button.focus();
            await page.keyboard.press("Enter");
          } else {
            await button.click();
          }
          const selected = JSON.parse(await page.getByTestId("selected").textContent());
          assert.equal(selected.id, item.id);
          assert.equal(selected.plugin, item.plugin?.stableId);
          assert.equal(selected.prompt, item.prompt[locale === "zh-CN" ? "cn" : "en"]);
        }
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
        await page.evaluate(async () => {
          document.activeElement?.blur();
          window.scrollTo({ top: 0, behavior: "instant" });
          document.body.scrollTo({ top: 0, behavior: "instant" });
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        await page.evaluate(() => document.fonts.ready);
        const viewport = await page.evaluate(() => ({
          background: getComputedStyle(document.body).backgroundColor,
          firstItemTop: document
            .querySelector("[data-draft-suggested-prompt]")
            .getBoundingClientRect().top,
        }));
        assert.notEqual(viewport.background, "rgba(0, 0, 0, 0)");
        assert.ok(viewport.firstItemTop >= 0, "Recommendation screenshots start at the first item");
        await page.screenshot({
          path: resolve(tmpdir(), `zcodium-recommendations-${mode}-${locale}-${width}.png`),
          fullPage: true,
        });
      }
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  console.log(
    "Bundled catalog browser smoke passed: scenes/templates and both feature modes, keyboard/click selection, local images/icons, responsive layouts, no external requests",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
