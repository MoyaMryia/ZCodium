import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/session-local-errors.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
});
const directory =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const cssName = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "Build desktop renderer before session error checks");
const css = await readFile(resolve(directory, cssName), "utf8");
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(outputFiles[0].contents);
  } else if (request.url === "/style.css") {
    response.setHeader("Content-Type", "text/css");
    response.end(css);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/fixture.js"></script>',
    );
  }
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
  page.setDefaultTimeout(10000);
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  for (const locale of ["en-US", "zh-CN"])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const code of ["1005", "1006", "3008", "3010", "1308", "429"]) {
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?locale=${locale}&code=${code}&theme=${width === 1280 ? "dark" : "light"}`,
        );
        const summary = page.getByText("Fixture provider limit reached", { exact: true });
        await summary.waitFor({ state: "attached" });
        const bounds = await summary.boundingBox();
        assert.ok(
          bounds && bounds.width > 100 && bounds.height > 0,
          `Error summary must remain readable at ${width}px: ${JSON.stringify(bounds)}`,
        );
        const banner = page.locator('[data-testid="chat-error-banner"]');
        assert.equal(await banner.getByText(/登录|套餐|升级|sign in|plan|upgrade/i).count(), 0);
        const mcp = page.getByRole("region", { name: "MCP tool result" });
        await mcp.getByText("Fixture MCP connection failed", { exact: true }).waitFor();
        assert.equal(await mcp.getByText(/Coding Plan|套餐/i).count(), 0);
        if (code !== "1005") continue;
        await banner.locator('[data-testid="chat-error-details-button"]').press("Enter");
        const dialog = page.getByRole("dialog");
        await dialog.getByText("Fixture safe error detail", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
        await banner
          .getByRole("button", {
            name: locale === "en-US" ? "Copy" : "复制",
            exact: true,
          })
          .click();
        await page.waitForFunction(() => window.errorFixture.copies.length === 1);
        const copied = await page.evaluate(() => window.errorFixture.copies[0]);
        for (const value of [
          "Fixture provider limit reached",
          "Fixture safe error detail",
          "local-fixture-trace",
        ])
          assert.ok(copied.includes(value));
        await banner
          .getByRole("button", { name: locale === "en-US" ? "Retry" : "重试", exact: true })
          .click();
        assert.equal(await page.evaluate(() => window.errorFixture.retries), 1);
        await banner
          .getByRole("button", {
            name: locale === "en-US" ? "Report issue" : "反馈问题",
            exact: true,
          })
          .click();
        assert.equal(await page.evaluate(() => window.errorFixture.diagnostics), 1);
        if (process.env.ZCODE_TEST_SCREENSHOTS) {
          await mkdir(process.env.ZCODE_TEST_SCREENSHOTS, { recursive: true });
          await page.screenshot({
            animations: "disabled",
            path: resolve(
              process.env.ZCODE_TEST_SCREENSHOTS,
              `session-errors-${locale}-${width}.png`,
            ),
          });
        }
        await banner
          .getByRole("button", {
            name: locale === "en-US" ? "Dismiss error" : "关闭错误提示",
            exact: true,
          })
          .click();
        await banner.waitFor({ state: "hidden" });
        await mcp.getByText("Fixture MCP connection failed", { exact: true }).waitFor();
      }
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Session error checks passed: custom provider codes, details, copy/local trace, retry, diagnostics, dismissal, MCP failures, EN/ZH narrow/wide; no external requests.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
