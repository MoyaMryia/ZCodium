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
  entryPoints: [resolve(import.meta.dirname, "fixtures/image-search-config.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: { "@": resolve(root, "packages/ui/src") },
  outdir: resolve(tmpdir(), "zcodium-image-search-config-fixture"),
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

  for (const locale of ["en-US", "zh-CN"]) {
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`http://127.0.0.1:${server.address().port}/?locale=${locale}`);
      const url = page.locator('input[data-config-key="imageSearchMcpUrl"]');
      const secret = page.locator('input[data-config-key="authorizationHeader"]');
      await url.waitFor();
      for (const input of [url, secret]) {
        const description = await input.getAttribute("aria-describedby");
        assert.ok(description, "Each field must explain the expected value");
        const text = await page.locator(`[id="${description}"]`).textContent();
        assert.match(
          text,
          input === url ? /Full HTTP MCP endpoint/ : /Complete Authorization header/,
        );
      }
      assert.equal(await secret.getAttribute("type"), "password");
      const zh = locale === "zh-CN";
      await page
        .getByRole("button", { name: zh ? "显示密钥" : "Show secret", exact: true })
        .click();
      assert.equal(await secret.getAttribute("type"), "text");
      await page
        .getByRole("button", { name: zh ? "隐藏密钥" : "Hide secret", exact: true })
        .click();
      assert.equal(await secret.getAttribute("type"), "password");
      const clear = page.getByTestId("plugin-store-config-clear");
      await clear.click();
      assert.equal(await secret.inputValue(), "");
      assert.equal(await clear.getAttribute("aria-pressed"), "true");
      await clear.click();
      assert.equal(await secret.inputValue(), "Bearer fixture-secret");
      await url.fill("https://images.example.invalid/custom/mcp");
      await page.getByTestId("plugin-store-config-save").click();
      assert.deepEqual(await page.evaluate(() => window.imageSearchPatch), {
        options: { imageSearchMcpUrl: "https://images.example.invalid/custom/mcp" },
        clearOptionKeys: [],
      });
      await clear.click();
      await page.getByTestId("plugin-store-config-save").click();
      assert.deepEqual(await page.evaluate(() => window.imageSearchPatch), {
        options: {},
        clearOptionKeys: ["authorizationHeader"],
      });
      assert.equal(await secret.inputValue(), "");
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }
  }
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Image search configuration: field guidance, masking, clear/undo and save patches passed at desktop/mobile widths in both locales; no external requests.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
