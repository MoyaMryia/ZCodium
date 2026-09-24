import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/local-share-context.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  outdir: resolve(tmpdir(), "zcodium-share-browser-fixture"),
  loader: { ".css": "empty", ".png": "dataurl" },
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
      const url = `http://127.0.0.1:${server.address().port}/?locale=${locale}`;
      await page.goto(url);
      const divider = page.locator('[data-conversation-share-import-divider="true"]');
      await divider.waitFor();
      assert.equal(
        await divider.innerText(),
        locale === "zh-CN" ? "导入的对话" : "Imported conversation",
      );
      assert.equal(await divider.evaluate((element) => element.tagName), "DIV");
      assert.equal(
        await page
          .getByText("The imported conversation stays on this device.", { exact: true })
          .count(),
        1,
      );
      await divider.click();
      assert.equal(page.url(), url);
      assert.equal(await divider.getAttribute("tabindex"), null);
      const message = page.getByRole("textbox", { name: locale === "zh-CN" ? "消息" : "Message" });
      for (
        let i = 0;
        i < 20 && !(await message.evaluate((element) => document.activeElement === element));
        i++
      )
        await page.keyboard.press("Tab");
      assert.equal(await message.evaluate((element) => document.activeElement === element), true);
      await page.keyboard.type("Continue from this conversation");
      assert.equal(await message.inputValue(), "Continue from this conversation");
      assert.deepEqual(await page.evaluate(() => window.externalActions), []);
      if (css)
        assert.equal(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        );
      if (process.env.ZCODE_TEST_SCREENSHOT_DIR)
        await page.screenshot({
          path: resolve(
            process.env.ZCODE_TEST_SCREENSHOT_DIR,
            `${basename(import.meta.filename, ".mjs")}-${locale}-${width}.png`,
          ),
          fullPage: true,
        });
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Imported context walkthrough passed: readable content, inert divider, keyboard continuation, both locales and widths, no external requests",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
