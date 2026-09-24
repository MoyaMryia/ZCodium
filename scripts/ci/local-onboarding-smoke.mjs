import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-onboarding.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const assets =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const assetNames = await readdir(assets);
const cssName = assetNames.find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "Build desktop before onboarding browser checks");
const css = await readFile(resolve(assets, cssName), "utf8");
const icon = await readFile(resolve(root, "public/logo/icons/512x512.png"));
const server = createServer(async (request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(outputFiles[0].contents);
  } else if (request.url === "/style.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
  } else if (request.url === "/public/logo/icons/512x512.png") {
    response.setHeader("Content-Type", "image/png");
    response.end(icon);
  } else if (assetNames.includes(request.url?.split("/").at(-1))) {
    response.end(await readFile(resolve(assets, request.url.split("/").at(-1))));
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><div id="root" class="font-sans"></div><script type="module" src="/fixture.js"></script>',
    );
  }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
const errors = [],
  requests = [];
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ZCODE_TEST_CHROMIUM_EXECUTABLE || undefined,
  });
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  for (const locale of ["en-US", "zh-CN"])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${url}/?locale=${locale}`);
      await page.getByText("Workspace ready").waitFor();
      assert.equal(await page.getByTestId("onboarding-page").count(), 0);
      assert.equal(await page.evaluate(() => window.onboardingFixture.reads), 0);
      await page.getByRole("button", { name: "Open local preferences" }).click();
      const next = page.getByRole("button", {
        name: locale === "en-US" ? "Next" : "下一步",
        exact: true,
      });
      const skip = page.getByRole("button", {
        name: locale === "en-US" ? "Skip" : "跳过",
        exact: true,
      });
      await page.getByTestId("onboarding-page").waitFor();
      await page.waitForFunction(() => window.onboardingFixture.reads === 1);
      const product = page.getByRole("button", {
        name: locale === "en-US" ? "Product / Project / Solutions" : "产品/项目/解决方案",
        exact: true,
      });
      assert.equal(await product.getAttribute("aria-pressed"), "true");
      await page.waitForFunction(() =>
        [...document.images].every((image) => image.complete && image.naturalWidth > 0),
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
      await page.screenshot({
        path: resolve(tmpdir(), `zcodium-onboarding-${locale}-${width}.png`),
      });
      await next.click();
      await next.click();
      await page.evaluate(() => {
        window.onboardingFixture.failNext = true;
      });
      await skip.click();
      await page.getByRole("alert").waitFor();
      assert.equal(await page.evaluate(() => window.onboardingFixture.writes.length), 0);
      await skip.click();
      await page.getByText("Workspace ready").waitFor();
      await page.waitForFunction(() => window.onboardingFixture.writes.length === 1);
      const result = await page.evaluate(() => window.onboardingFixture);
      assert.equal(result.writes[0].memoryEnabled, null);
      assert.equal(result.writes[0].proactiveSuggestionsEnabled, null);
      assert.equal("userId" in result.writes[0], false);
      assert.equal(result.settingsWrites.length, 1);
      assert.deepEqual(result.forbidden, []);
      await page.getByRole("button", { name: "Open local preferences" }).click();
      await page.keyboard.press("Escape");
      await page.getByText("Workspace ready").waitFor();
      assert.equal(await page.evaluate(() => window.onboardingFixture.writes.length), 1);
    }
  // Advancing is an explicit choice: late prefill must not return the user to step one.
  await page.goto(`${url}/?delay=1`);
  await page.getByRole("button", { name: "Open local preferences" }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.evaluate(() => window.onboardingFixture.resolveEntry());
  await page.getByRole("button", { name: /Coding/ }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Software / Data / AI", exact: true }).count(),
    0,
  );
  await page.screenshot({ path: resolve(tmpdir(), "zcodium-local-onboarding.png") });
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Local onboarding browser checks passed: startup, save retry, skip, cancel, late prefill, en/zh, mobile/desktop; no external requests",
  );
} catch (error) {
  console.error({ errors, requests });
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error(await page.locator("body").innerText());
    await page.screenshot({ path: resolve(tmpdir(), "zcodium-local-onboarding-failure.png") });
  }
  await page.goto(`${url}/`);
  await page.getByRole("button", { name: "Open local preferences" }).click();
  await page.getByRole("button", { name: "Software / Data / AI", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await page.getByRole("button", { name: /Coding mode/ }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await page.getByText("Workspace ready").waitFor();
  await page.waitForFunction(() => window.onboardingFixture.writes.length === 1);
  const saved = await page.evaluate(() => window.onboardingFixture.writes[0]);
  assert.equal(saved.occupation, "developer");
  assert.equal(saved.interfaceMode, "coding");
  assert.equal(saved.memoryEnabled, false);
  assert.equal(saved.proactiveSuggestionsEnabled, false);
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
