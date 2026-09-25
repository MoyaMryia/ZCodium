// Actual help/error/remote components, with native platform effects replaced by recording ports.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";
const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-feedback.jsx")],
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
  const requests = [],
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  for (const locale of ["en-US", "zh-CN"]) {
    for (const desktop of [true, false]) {
      await page.setViewportSize({ width: desktop ? 1280 : 390, height: 900 });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?locale=${locale}&desktop=${desktop ? 1 : 0}`,
      );
      const cn = locale === "zh-CN";
      const menu = page.getByRole("button", { name: cn ? "帮助" : "Help", exact: true });
      const openMenu = async () => {
        await menu.focus();
        await page.keyboard.press("Enter");
      };
      await openMenu();
      await page
        .getByRole("menuitem", { name: cn ? "问题上报" : "Report an issue", exact: true })
        .click();
      await openMenu();
      await page
        .getByRole("menuitem", { name: cn ? "给产品提需求" : "Request a feature", exact: true })
        .click();
      await openMenu();
      const exportItem = page.getByRole("menuitem", {
        name: cn ? "导出日志" : "Export logs",
        exact: true,
      });
      assert.equal(await exportItem.count(), desktop ? 1 : 0);
      if (desktop) await exportItem.click();
      else await page.keyboard.press("Escape");
      await page
        .getByTestId("session-error")
        .getByRole("button", { name: cn ? "反馈问题" : "Report issue" })
        .click();
      await page
        .getByTestId("session-error")
        .getByRole("button", { name: cn ? "重新连接" : "Reconnect" })
        .click();
      await page
        .getByTestId("remote-error")
        .getByRole("button", { name: cn ? "去反馈" : "Feedback" })
        .click();
      const actions = await page.evaluate(() => window.actions);
      assert.equal(actions.filter((action) => action.name === "feedback").length, 4);
      assert.equal(actions.filter((action) => action.name === "reconnect").length, 1);
      assert.equal(actions.filter((action) => action.name === "export").length, desktop ? 1 : 0);
      for (const action of actions.filter((action) => action.name === "feedback"))
        assert.deepEqual(action.args, []);
      assert.doesNotMatch(JSON.stringify(actions), /PRIVATE|private-session|workspace/);
    }
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Feedback UI passed: keyboard menus, desktop/mobile, both locales, no collection/upload, local export and reconnect preserved",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
