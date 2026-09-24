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
  entryPoints: [resolve(import.meta.dirname, "fixtures/no-official-purchase.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  outdir: resolve(tmpdir(), "zcodium-purchase-browser-fixture"),
  loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = outputFiles.find((file) => file.path.endsWith(".js")).contents;
let css = "";
// CI 可只跑行为检查；本地人工视觉走查使用真实桌面构建的样式。
if (process.env.ZCODE_TEST_RENDERER_ASSETS) {
  const directory = process.env.ZCODE_TEST_RENDERER_ASSETS;
  const file = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
  assert.ok(file, "Desktop production CSS must exist for visual walkthrough");
  css = await readFile(resolve(directory, file), "utf8");
}
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(script);
    return;
  }
  if (request.url === "/styles.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
    return;
  }
  if (request.url?.startsWith("/assets/")) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(
    '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"><div id="root"></div><script type="module" src="/fixture.js"></script>',
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
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });

  for (const locale of ["zh-CN", "en-US"])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      for (const status of [
        "disconnected",
        "notPurchased",
        "purchased",
        "checking",
        "unavailable",
      ]) {
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?locale=${locale}&status=${status}&theme=${width === 1280 ? "dark" : "light"}`,
        );
        const configure = page.getByRole("button", {
          name: locale === "zh-CN" ? "配置模型" : "Configure model",
          exact: true,
        });
        await configure.waitFor();
        assert.equal(await page.locator("webview,iframe").count(), 0);
        assert.equal(
          await page
            .getByRole("button", { name: /升级|续费|购买|订阅|Upgrade|Renew|Subscribe|Purchase/i })
            .count(),
          0,
        );
        await configure.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("region", { name: "Model settings" }).waitFor();
        assert.equal((await page.evaluate(() => window.purchaseFixture)).configured, 1);
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        await page.getByRole("menuitem").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("menu").waitFor({ state: "hidden" });
        assert.equal((await page.evaluate(() => window.purchaseFixture)).usage, 0);
        await page.getByRole("button", { name: "Menu", exact: true }).click();
        const items = page.getByRole("menuitem");
        assert.equal(await items.count(), 1);
        await items.first().press("Enter");
        assert.equal((await page.evaluate(() => window.purchaseFixture)).usage, 1);
        assert.equal(await page.getByText(/开通后启用|enabled after subscription/i).count(), 0);
        if (status === "unavailable") {
          const region = page.getByRole("region", { name: "Connection status" });
          const retry = region.getByRole("button", {
            name: locale === "zh-CN" ? "重试" : "Retry",
            exact: true,
          });
          await retry.click();
          await region
            .getByText(locale === "zh-CN" ? "查询中" : "Checking", { exact: true })
            .waitFor();
          assert.equal(await retry.count(), 0);
          // 首次查询失败后恢复重试入口，第二次成功后以新状态替换错误。
          await page.evaluate(() => window.completePurchaseFixtureRetry("unavailable"));
          await retry.click();
          await page.evaluate(() => window.completePurchaseFixtureRetry("purchased"));
          await region
            .getByText(locale === "zh-CN" ? "已开通" : "Subscribed", { exact: true })
            .waitFor();
          assert.equal(await retry.count(), 0);
          assert.equal((await page.evaluate(() => window.purchaseFixture)).retries, 2);
        }
        if (process.env.ZCODE_TEST_SCREENSHOT_DIR && status === "notPurchased") {
          await page.waitForTimeout(300);
          await page.screenshot({
            path: resolve(
              process.env.ZCODE_TEST_SCREENSHOT_DIR,
              `no-purchase-${locale}-${width}.png`,
            ),
          });
        }
      }
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Purchase removal walkthrough passed: model setup action, usage menu cancellation, failed retry and recovery, five account states, zh/en narrow/wide; no purchase controls, embedded payment pages or external requests.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
