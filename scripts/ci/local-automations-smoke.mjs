import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-automations.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  loader: { ".css": "empty", ".svg": "dataurl", ".png": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "local-automations-only",
      setup(builder) {
        builder.onResolve(
          {
            filter: /useOffPeak|offPeakTaskStore|OffPeakEditView|OffPeakTaskList/,
          },
          ({ path }) => {
            throw new Error(`Retired idle task dependency: ${path}`);
          },
        );
      },
    },
  ],
});
const directory =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const cssName = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(cssName, "Build desktop renderer before local automation browser checks");
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
      '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><style>html,body,#root { height: auto; overflow: visible; }</style><div id="root"></div><script type="module" src="/fixture.js"></script>',
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
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  for (const locale of ["en-US", "zh-CN"])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?locale=${locale}&theme=${width === 1280 ? "dark" : "light"}&tab=idle`,
      );
      await page.getByText("Fixture active", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.localAutomationsFixture.consumed), 1);
      assert.equal(await page.locator("[data-automations-idle-templates]").count(), 0);
      assert.equal(await page.locator('[data-testid="offpeak-tab"]').count(), 0);
      assert.equal(await page.locator('[data-testid="offpeak-create-button"]').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(
        await page
          .getByRole("complementary", { name: "Historical task" })
          .getByRole("button")
          .count(),
        0,
      );
      const refresh = page.getByRole("button", {
        name: locale === "en-US" ? "Refresh" : "刷新",
        exact: true,
      });
      const before = await page.evaluate(
        () => window.localAutomationsFixture.calls.filter((item) => item === "list").length,
      );
      await refresh.click();
      await page.waitForFunction(
        (before) =>
          window.localAutomationsFixture.calls.filter((item) => item === "list").length > before,
        before,
      );
      await page.evaluate(() => {
        window.localAutomationsFixture.failNext = true;
      });
      await refresh.click();
      await page.waitForFunction(() => window.localAutomationsFixture.readState().error);
      await page.getByText("Fixture active", { exact: true }).waitFor();
      await refresh.click();
      await page.waitForFunction(
        () =>
          !window.localAutomationsFixture.readState().error &&
          !window.localAutomationsFixture.readState().loading,
      );
      const awake = page.locator('[data-automations-keep-awake] button[role="switch"]');
      await awake.click();
      await page.waitForFunction(() =>
        window.localAutomationsFixture.calls.some((call) => call.settings?.keepAwakeWhileRunning),
      );
      assert.equal(await awake.getAttribute("aria-checked"), "true");
      await mkdir("/tmp/zcodium-local-automations", { recursive: true });
      await page.screenshot({
        path: `/tmp/zcodium-local-automations/${locale}-${width}-list.png`,
        fullPage: true,
        animations: "disabled",
      });
      const filters = page.locator('[data-testid="automations-status-filter"] button');
      assert.equal(await filters.count(), 4);
      await filters.nth(2).click();
      assert.equal(await page.getByText("Fixture active", { exact: true }).count(), 0);
      await page.getByText("Fixture completed", { exact: true }).waitFor();
      await filters.nth(0).click();
      await page.getByText("Fixture active", { exact: true }).click();
      const title = page.getByTestId("automation-form-title");
      await title.waitFor();
      assert.equal(await title.inputValue(), "Fixture active");
      assert.equal(
        await page.getByTestId("automation-form-prompt").inputValue(),
        "Fixture task instructions",
      );
      await title.fill("Edited local task");
      await page.evaluate(() => {
        window.localAutomationsFixture.failSave = true;
      });
      const save = page.getByTestId("automation-form-submit");
      await save.click();
      await page.waitForFunction(() => window.localAutomationsFixture.readState().error);
      assert.equal(await title.inputValue(), "Edited local task");
      await save.click();
      await page.getByText("Edited local task", { exact: true }).waitFor();
      const updates = await page.evaluate(() =>
        window.localAutomationsFixture.calls
          .filter((call) => call.update)
          .map((call) => call.update),
      );
      assert.equal(updates.length, 2);
      assert.equal(updates[1].workspacePath, "/fixture/project");
      assert.equal(updates[1].modelSelection.providerId, "fixture-api");
      assert.equal(updates[1].modelSelection.options.reasoningLevel, "high");
      await page.evaluate(() =>
        window.localAutomationsFixture.navigate({ tab: "idle", id: "offpeak-old" }),
      );
      await page.waitForFunction(() => window.localAutomationsFixture.consumed === 2);
      assert.equal(await page.getByTestId("automation-form-title").count(), 0);
      await page.getByText("Edited local task", { exact: true }).waitFor();

      assert.deepEqual(await page.evaluate(() => window.localAutomationsFixture.forbidden), []);
      await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}&empty=1`);
      await page.locator("[data-automations-empty-state]").waitFor();
      await page.locator("[data-automations-scheduled-templates] button").first().click();
      await page.getByTestId("automation-form-title").waitFor();
      assert.equal(
        await page.getByTestId("automation-form-title").inputValue(),
        locale === "en-US" ? "Fixture template" : "本地模板",
      );
      assert.equal(
        await page.getByTestId("automation-form-prompt").inputValue(),
        locale === "en-US" ? "Fixture template instructions" : "模板任务指令",
      );
      await page.screenshot({
        path: `/tmp/zcodium-local-automations/${locale}-${width}-template.png`,
        fullPage: true,
        animations: "disabled",
      });

      await page.getByTestId("automation-form-submit").click();
      await page.locator('[data-testid="automations-list"]').waitFor();
      const creates = await page.evaluate(() =>
        window.localAutomationsFixture.calls.filter((call) => call.create),
      );
      assert.equal(creates.length, 1);
      assert.equal(creates[0].create.workspacePath, "/fixture/project");
      assert.equal(creates[0].create.cronExpr, "0 9 * * *");
      assert.equal(creates[0].create.modelSelection.providerId, "fixture-api");
      await page.getByTestId("automation-create-menu").click();
      await page
        .getByRole("menuitem", { name: locale === "en-US" ? "Create in chat" : "去会话中创建" })
        .click();
      assert.equal(await page.evaluate(() => window.localAutomationsFixture.chat.length), 1);
      await page.getByTestId("automation-create-manually").click();
      await page.getByTestId("automation-form-title").waitFor();
      assert.equal(await page.getByTestId("automation-form-prompt").inputValue(), "");
      assert.deepEqual(await page.evaluate(() => window.localAutomationsFixture.forbidden), []);
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?locale=${locale}&tab=scheduled&id=fixture-0`,
      );
      await page.getByTestId("automation-form-title").waitFor();
      assert.equal(await page.getByTestId("automation-form-title").inputValue(), "Fixture active");
      assert.equal(await page.evaluate(() => window.localAutomationsFixture.consumed), 1);
      assert.deepEqual(await page.evaluate(() => window.localAutomationsFixture.forbidden), []);
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Local automation UI: list/filter/refresh/editor/templates, legacy navigation and historical card passed",
  );
} finally {
  await browser?.close();
  server.close();
}
