import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-context.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
  plugins: [
    {
      name: "no-context-services",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /CodingPlan|codingPlan|StartPlan|startPlan|[Uu]sageEntitlement|useServices|contextQuota/,
          },
          ({ path }) => {
            throw new Error(`Context display must not read official services: ${path}`);
          },
        );
      },
    },
  ],
});
const directory =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const cssName = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "Build desktop renderer before context checks");
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
  const errors = [],
    requests = [];
  for (const locale of ["en-US", "zh-CN"])
    for (const touch of [false, true]) {
      const width = touch ? 320 : 1280;
      const context = await browser.newContext({
        viewport: { width, height: 850 },
        hasTouch: touch,
        isMobile: touch,
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
        requests.push(route.request().url());
        return route.abort();
      });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?locale=${locale}&theme=${touch ? "light" : "dark"}`,
      );
      const trigger = page.locator('[data-testid="chat-context-usage-trigger"]');
      const panel = page.locator('[data-slot="hover-card-content"]');
      await trigger.waitFor();
      if (touch) await trigger.tap();
      else await trigger.hover();
      await panel.waitFor();
      await panel.getByText("75%", { exact: true }).waitFor();
      await panel.getByText("25%", { exact: true }).waitFor();
      await panel.getByText("90%", { exact: true }).waitFor();
      assert.equal(await panel.getByText(/Coding Plan|Start Plan|套餐|重置|Reset/i).count(), 0);
      const box = await panel.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, "Context panel fits the viewport");
      if (process.env.ZCODE_TEST_SCREENSHOTS) {
        await mkdir(process.env.ZCODE_TEST_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          animations: "disabled",
          path: resolve(process.env.ZCODE_TEST_SCREENSHOTS, `local-context-${locale}-${width}.png`),
        });
      }
      if (touch) {
        await page.getByRole("button", { name: "After context" }).tap();
      } else {
        await page.keyboard.press("Escape");
      }
      await panel.waitFor({ state: "hidden" });
      if (!touch) {
        await page.getByRole("button", { name: "Before context" }).focus();
        await page.keyboard.press("Tab");
        assert.equal(await trigger.evaluate((element) => element === document.activeElement), true);
        await panel.waitFor();
        await page.keyboard.press("Escape");
        await panel.waitFor({ state: "hidden" });
      }
      await page.evaluate(() =>
        window.contextFixture.setUsage({ used: 20000, size: 10000, cache: { hitRate: 0.4 } }),
      );
      if (touch) await trigger.tap();
      else {
        await page.mouse.move(0, 0);
        await trigger.hover();
      }
      await panel.waitFor();
      await panel.getByText(/100%/).waitFor();
      assert.equal(await panel.getByText("40%", { exact: true }).count(), 0);
      assert.match(await trigger.getAttribute("aria-label"), /20,000/);
      for (const invalid of [
        null,
        { used: 0, size: 10000 },
        { used: 1, size: 0 },
        { used: -1, size: 10 },
      ]) {
        await page.evaluate((value) => window.contextFixture.setUsage(value), invalid);
        await trigger.waitFor({ state: "hidden" });
      }
      await page.evaluate(() => window.contextFixture.setUsage({ used: 100, size: 1000 }));
      await trigger.waitFor();
      await context.close();
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Context checks passed: local tokens, source breakdown, cache rate, hover/keyboard/touch, empty and updated snapshots; no service access or external requests.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
