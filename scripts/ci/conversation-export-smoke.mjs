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
  entryPoints: [resolve(import.meta.dirname, "fixtures/conversation-export.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  outdir: resolve(tmpdir(), "zcodium-export-browser-fixture"),
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
  for (const locale of ["zh-CN", "en-US"]) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 850 });
      for (const outcome of ["cancel", "failure", "download"]) {
        await page.goto(
          `http://127.0.0.1:${server.address().port}/?locale=${locale}&outcome=${outcome}`,
        );
        const title = page.getByRole("textbox");
        await title.fill("My selected conversation");
        assert.equal(await page.getByRole("checkbox").count(), 0);
        assert.equal(await page.getByRole("combobox").count(), 0);
        const confirm = page.getByTestId("conversation-share-confirm");
        await title.press("Tab");
        assert.ok(await confirm.evaluate((element) => document.activeElement === element));
        if (process.env.ZCODE_TEST_SCREENSHOT_DIR && outcome === "cancel") {
          await page.screenshot({
            path: resolve(
              process.env.ZCODE_TEST_SCREENSHOT_DIR,
              `export-confirm-${locale}-${width}.png`,
            ),
          });
        }
        let download;
        if (outcome === "download") {
          const waitDownload = page.waitForEvent("download");
          await page.keyboard.press("Enter");
          download = await waitDownload;
          assert.equal(download.suggestedFilename(), "conversation-report.zcodium");
          const data = await readFile(await download.path());
          assert.deepEqual([...data], [80, 75, 0, 255, 1, 2, 3]);
        } else {
          await page.keyboard.press("Enter");
          await page.waitForFunction(() => window.exportCalls.releases === 1);
          assert.equal(await page.getByTestId("conversation-share-success-dock").count(), 0);
          if (outcome === "cancel")
            assert.equal(await title.inputValue(), "My selected conversation");
          else await page.getByRole("alert").waitFor();
          await confirm.click();
        }
        await page.getByTestId("conversation-share-success-dock").waitFor();
        assert.equal(await page.getByTestId("conversation-share-copy-link").count(), 0);
        assert.equal(await page.getByTestId("conversation-share-open-browser").count(), 0);
        assert.equal(
          await page.getByTestId("conversation-share-result-title").innerText(),
          outcome === "download" ? "conversation-report.zcodium" : "renamed-by-user.zcodium",
        );
        const calls = await page.evaluate(() => window.exportCalls);
        assert.equal(calls.saves, outcome === "download" ? 1 : 2);
        assert.equal(calls.releases, calls.saves);
        const status = await page.getByTestId("conversation-share-success-status").innerText();
        assert.match(
          status,
          outcome === "download" ? /已开始下载|Download started/ : /文件已保存|File saved/,
        );
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (process.env.ZCODE_TEST_SCREENSHOT_DIR)
          await page.screenshot({
            path: resolve(
              process.env.ZCODE_TEST_SCREENSHOT_DIR,
              `export-${locale}-${width}-${outcome}.png`,
            ),
          });
        await page.getByTestId("conversation-share-success-dismiss").click();
        await page.getByText("Closed", { exact: true }).waitFor();
      }
      // Before any save, Back/Cancel returns without invoking the platform.
      await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}`);
      await page
        .getByRole("button", { name: locale === "zh-CN" ? "取消" : "Cancel", exact: true })
        .click();
      assert.equal((await page.evaluate(() => window.exportCalls)).saves, 0);
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Conversation export browser walkthrough passed: cancel, retry, download, keyboard, bilingual desktop/mobile; no external requests.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
