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
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-preferences.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  outdir: resolve(tmpdir(), "zcodium-local-preferences-fixture"),
  loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = outputFiles.find((file) => file.path.endsWith(".js")).contents;
let css = "";
// 验证真实菜单的定位、焦点与点击；复用产品 CSS。
{
  const directory =
    process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
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
  await page.addInitScript(() => localStorage.clear());
  const errors = [],
    requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });

  const visit = async (query) => {
    await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
    await page.getByTestId("sidebar-preferences-trigger").waitFor();
  };
  const open = async () => {
    // Radix 选择项后会完成关闭动画和焦点归还；下一次打开从稳定关闭态开始。
    await page.getByRole("menu").first().waitFor({ state: "hidden" });
    await page.getByTestId("sidebar-preferences-trigger").click();
    await page.getByRole("menu").first().waitFor();
  };
  const sub = async (name) => {
    const item = page.getByRole("menuitem", { name, exact: true });
    await item.focus();
    await page.keyboard.press("ArrowRight");
  };
  for (const locale of ["zh-CN", "en-US"]) {
    const zh = locale === "zh-CN";
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await visit(`locale=${locale}&theme=${width === 1280 ? "dark" : "light"}`);
      const quotaStateKeys = await page.evaluate(() =>
        Object.keys(window.preferencesFixture.readState()).filter((key) =>
          /quota|codereset/i.test(key),
        ),
      );
      assert.deepEqual(quotaStateKeys, [], "Global store must not retain retired quota state");
      const changesBefore = await page.evaluate(() => {
        const fixture = window.preferencesFixture;
        const count = fixture.changes.length;
        fixture.receiveBroadcast({
          channel: "state:codereset-autoplayed",
          payload: { sourceKey: "fixture" },
        });
        fixture.receiveBroadcast({ channel: "state:locale", payload: "fixture-broadcast-locale" });
        fixture.receiveBroadcast({ channel: "state:theme", payload: "zai-dark" });
        return count;
      });
      await page.waitForFunction(() => {
        const state = window.preferencesFixture.readState();
        return state.locale === "fixture-broadcast-locale" && state.theme === "zai-dark";
      });
      assert.equal(
        await page.evaluate(() => window.preferencesFixture.changes.length),
        changesBefore,
        "Received settings changes must not echo back to other windows",
      );
      await page.evaluate(
        (theme) =>
          window.preferencesFixture.receiveBroadcast({
            channel: "state:theme",
            payload: theme,
          }),
        width === 1280 ? "zai-dark" : "zai-light",
      );
      const trigger = page.getByTestId("sidebar-preferences-trigger");
      assert.equal(await trigger.getAttribute("aria-label"), zh ? "偏好设置" : "Preferences");
      assert.equal(await page.getByText("Retired account", { exact: true }).count(), 0);
      assert.equal(await page.locator("footer img").count(), 0);
      const exportTrigger = page.getByTestId("conversation-share-trigger");
      await exportTrigger.click();
      assert.equal(await exportTrigger.getAttribute("aria-pressed"), "true");
      await exportTrigger.click();
      assert.equal(await exportTrigger.getAttribute("aria-pressed"), "false");
      await page.evaluate(() => window.preferencesFixture.setTaskId(null));
      await exportTrigger.waitFor({ state: "hidden" });
      await page.evaluate(() => window.preferencesFixture.setTaskId("fixture-other-task"));
      await exportTrigger.waitFor();
      assert.equal(await exportTrigger.getAttribute("aria-pressed"), "false");
      await trigger.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menu").first().waitFor();
      if (process.env.ZCODE_TEST_SCREENSHOTS_DIR) {
        await page.screenshot({
          path: resolve(
            process.env.ZCODE_TEST_SCREENSHOTS_DIR,
            `preferences-${locale}-${width}.png`,
          ),
          animations: "disabled",
        });
      }
      await page.keyboard.press("Escape");
      await page.waitForFunction(
        () => document.activeElement?.dataset.testid === "sidebar-preferences-trigger",
      );
      assert.equal(await trigger.getAttribute("data-state"), "closed");
      assert.equal(
        await page.evaluate(
          () => window.preferencesFixture.usage + window.preferencesFixture.settings,
        ),
        0,
      );

      await open();
      await sub(zh ? "界面主题" : "App theme");
      await page
        .getByRole("menuitemradio", { name: zh ? "浅色主题" : "Light theme", exact: true })
        .click();
      await page.waitForFunction(() => localStorage.getItem("zcode-theme") === "zai-light");
      await open();
      await sub(zh ? "界面模式" : "Interface mode");
      await page
        .getByRole("menuitemradio", { name: zh ? "办公模式" : "Office mode", exact: true })
        .click();
      assert.ok(
        await page.evaluate(() =>
          window.preferencesFixture.changes.some(
            (change) => change.channel === "state:interfaceMode",
          ),
        ),
      );

      await open();
      await sub(zh ? "界面缩放" : "Interface zoom");
      const actualSize = page.getByRole("menuitem", {
        name: zh ? "实际大小" : "Actual size",
        exact: false,
      });
      assert.equal(await actualSize.getAttribute("aria-disabled"), "true");
      await page.getByRole("menuitem", { name: zh ? "放大" : "Zoom in", exact: false }).click();
      await open();
      await sub(zh ? "界面缩放" : "Interface zoom");
      assert.notEqual(await actualSize.getAttribute("aria-disabled"), "true");
      await actualSize.click();
      assert.equal(await page.evaluate(() => window.preferencesFixture.commands.length), 2);
      await open();
      await sub(zh ? "界面缩放" : "Interface zoom");
      await page.evaluate(() => window.preferencesFixture.setZoom(5));
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="menuitem"][aria-disabled="true"]')].some((el) =>
          /放大|Zoom in/.test(el.textContent),
        ),
      );
      assert.equal(
        await page
          .getByRole("menuitem", { name: zh ? "放大" : "Zoom in", exact: false })
          .getAttribute("aria-disabled"),
        "true",
      );
      await page.evaluate(() => window.preferencesFixture.setZoom(-3));
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[role="menuitem"][aria-disabled="true"]')].some((el) =>
          /缩小|Zoom out/.test(el.textContent),
        ),
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");

      await open();
      await page
        .getByRole("menuitem", { name: zh ? "使用统计" : "Usage stats", exact: true })
        .click();
      assert.equal(await page.evaluate(() => window.preferencesFixture.usageIntent), "usage");
      assert.equal(await page.evaluate(() => window.preferencesFixture.usage), 1);
      await page.getByRole("button", { name: zh ? "设置" : "Settings", exact: true }).click();
      assert.equal(await page.evaluate(() => window.preferencesFixture.settings), 1);

      await open();
      await sub(zh ? "界面语言" : "Language");
      await page
        .getByRole("menuitemradio", { name: zh ? "English" : "中文简体", exact: true })
        .click();
      await page
        .getByRole("button", { name: zh ? "Preferences" : "偏好设置", exact: true })
        .waitFor();
      await open();
      assert.equal(
        await page
          .getByRole("menuitem", { name: /Login|Logout|Connect|Disconnect|登录|登出|连接使用/i })
          .count(),
        0,
      );
      assert.deepEqual(await page.evaluate(() => window.preferencesFixture.forbidden), []);
      const boxes = await page.locator('[role="menu"]').evaluateAll((nodes) =>
        nodes.map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x, right: r.right, bottom: r.bottom };
        }),
      );
      for (const box of boxes) {
        assert.ok(box.x >= 0);
        assert.ok(box.right <= width);
        assert.ok(box.bottom <= 800);
      }
      await page.evaluate(() => window.preferencesFixture.unmount());
      await page.waitForFunction(() => window.preferencesFixture.zoomListeners === 0);
    }
  }
  await visit("locale=en-US&platform=web&mode=read-failure");
  await open();
  assert.equal(
    await page.getByRole("menuitem", { name: "Interface zoom", exact: true }).count(),
    0,
  );
  await page.getByRole("menuitem", { name: "Usage stats", exact: true }).click();
  assert.equal(await page.evaluate(() => window.preferencesFixture.usage), 1);
  await visit("locale=en-US&mode=back");
  await page.getByRole("button", { name: "Back to workspace", exact: true }).click();
  assert.equal(await page.evaluate(() => window.preferencesFixture.settings), 1);
  await visit("locale=en-US&mode=no-navigation");
  assert.ok(await page.getByRole("button", { name: "Settings", exact: true }).isDisabled());
  await open();
  assert.equal(
    await page
      .getByRole("menuitem", { name: "Usage stats", exact: true })
      .getAttribute("aria-disabled"),
    "true",
  );
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Local preferences walkthrough passed: keyboard/cancel, locale/theme/mode, zoom/events, navigation, read failure, no account IO.",
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) {
    console.error(
      await page.evaluate(() => ({
        fixture: window.preferencesFixture,
        text: document.body.innerText,
        menu: document
          .querySelector('[data-testid="sidebar-preferences-trigger"]')
          ?.getAttribute("data-state"),
      })),
    );
    await page.screenshot({ path: resolve(tmpdir(), "zcodium-preferences-failure.png") });
  }
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
