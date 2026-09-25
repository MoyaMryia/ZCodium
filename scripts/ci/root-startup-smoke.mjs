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
  entryPoints: [resolve(import.meta.dirname, "fixtures/root-startup.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  alias: {
    "@": resolve(root, "packages/ui/src"),
    ...Object.fromEntries(
      [
        "root/RootWorkspaceContent",
        "SettingsPage",
        "root/DiffsWorkerPoolProvider",
        "onboarding/OccupationOnboarding",
        "onboarding/OnboardingDialog",
        "SSHDialog",
        "DirectoryBrowser",
        "cua-permission/CuaPermissionObservationAttachment",
      ].map((name) => [
        `@/${name}.js`,
        resolve(import.meta.dirname, "fixtures/root-startup-leaves.jsx"),
      ]),
    ),
  },
  outdir: resolve(tmpdir(), "zcodium-root-startup-fixture"),
  loader: { ".css": "empty", ".png": "dataurl", ".svg": "dataurl" },
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = outputFiles.find((file) => file.path.endsWith(".js")).contents;
let css = "";
// 验证真实启动/错误界面的定位与点击；复用产品 CSS。
{
  const directory =
    process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
  const file = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
  assert.ok(file, "Desktop production CSS must exist for visual walkthrough");
  css = await readFile(resolve(directory, file), "utf8");
}
// esbuild 不重写 new URL 静态资源路径；提供产品使用的同一份本地图标。
const startupLogo = await readFile(resolve(root, "public/logo/icons/512x512.png"));
const server = createServer((request, response) => {
  if (request.url === "/public/logo/icons/512x512.png") {
    response.setHeader("Content-Type", "image/png");
    response.end(startupLogo);
    return;
  }
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
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error(error.message);
  });
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });

  const visit = async (query) => {
    await page.goto(`http://127.0.0.1:${server.address().port}/?${query}`);
    await page.getByRole("region", { name: "Workspace ready" }).waitFor();
  };
  for (const mode of ["restored", "initial", "empty"]) {
    await visit(`mode=${mode}&models=pending`);
    assert.equal(
      await page.getByTestId("workspace-path").innerText(),
      `/fixture/${mode === "empty" ? "default" : mode}`,
    );
    assert.equal(await page.evaluate(() => window.startupFixture.modelReads), 1);
    assert.equal(
      await page.evaluate(() => window.startupFixture.directoryCreates),
      1,
      "desktop restoration ensures the existing conversation backing workspace once",
    );
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await page.getByRole("region", { name: "Settings ready" }).waitFor();
    await page.evaluate(() => window.startupFixture.resolveModels());
    assert.deepEqual(await page.evaluate(() => window.startupFixture.forbidden), []);
  }
  for (const locale of ["zh-CN", "en-US"]) {
    await visit(`mode=restored&models=failure&locale=${locale}`);
    const retry = page.getByRole("button", {
      name: locale === "zh-CN" ? "重试" : "Retry",
      exact: true,
    });
    await retry.waitFor();
    await retry.click();
    await retry.waitFor({ state: "hidden" });
    assert.equal(await page.getByTestId("workspace-path").innerText(), "/fixture/restored");
    assert.equal(await page.evaluate(() => window.startupFixture.modelReads), 2);
  }
  await visit("mode=initial&platform=web&models=pending");
  assert.equal(await page.getByTestId("workspace-path").innerText(), "/fixture/initial");
  for (const recovery of ["retry", "folder"]) {
    const zh = recovery === "retry";
    await page.setViewportSize({ width: zh ? 390 : 1280, height: 800 });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/?mode=directory-failure&locale=${zh ? "zh-CN" : "en-US"}`,
    );
    const alert = page.getByRole("alert");
    await alert.waitFor();
    await page.waitForFunction(() => {
      const logo = document.querySelector('[data-testid="root-startup-loading"] img');
      return logo?.complete && logo.naturalWidth > 0;
    });
    assert.ok(!(await alert.innerText()).includes("private directory"));
    if (process.env.ZCODE_TEST_SCREENSHOTS_DIR)
      await page.screenshot({
        path: resolve(
          process.env.ZCODE_TEST_SCREENSHOTS_DIR,
          `startup-failure-${zh ? "zh-CN" : "en-US"}.png`,
        ),
        animations: "disabled",
      });
    const openFolder = page.getByRole("button", {
      name: zh ? "打开文件夹" : "Open folder",
      exact: true,
    });
    await openFolder.click();
    await page.waitForFunction(() => window.startupFixture.directorySelections === 1);
    assert.ok(await alert.isVisible(), "cancel keeps the failure recovery surface");
    await (
      recovery === "retry" ? page.getByRole("button", { name: "重试", exact: true }) : openFolder
    ).click();
    await page.getByRole("region", { name: "Workspace ready" }).waitFor();
    assert.equal(
      await page.getByTestId("workspace-path").innerText(),
      recovery === "retry" ? "/fixture/default" : "/fixture/chosen",
    );
    assert.equal(
      await page.evaluate(() => window.startupFixture.directoryCreates),
      recovery === "retry" ? 2 : 1,
    );
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/?mode=directory-pending`);
  await page.waitForFunction(() => typeof window.startupFixture.resolveDirectory === "function");
  await page.evaluate(() => window.startupFixture.openWorkspace("/fixture/newly-opened"));
  await page.getByRole("region", { name: "Workspace ready" }).waitFor();
  assert.equal(await page.getByTestId("workspace-path").innerText(), "/fixture/newly-opened");
  await page.evaluate(() => window.startupFixture.resolveDirectory());
  await page.getByTestId("root-startup-loading").waitFor({ state: "hidden" });
  assert.equal(await page.getByTestId("workspace-path").innerText(), "/fixture/newly-opened");
  await page.goto(
    `http://127.0.0.1:${server.address().port}/?mode=directory-pending&models=pending`,
  );
  await page.waitForFunction(() => typeof window.startupFixture.resolveDirectory === "function");
  await page.evaluate(() => window.startupFixture.unmount());
  await page.getByText("Unmounted", { exact: true }).waitFor();
  await page.evaluate(() => {
    window.startupFixture.resolveDirectory();
    window.startupFixture.resolveModels();
  });
  assert.deepEqual(await page.evaluate(() => window.startupFixture.platformListeners), {});
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
  console.log(
    "Root startup walkthrough passed: pending models never block restoration/settings; model error retry, initial/empty/restored workspace, directory failure/cancel/retry/alternative folder, late results/unmount, Web entry, no Renderer OAuth IO.",
  );
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0];
  if (page)
    console.error(
      await page.evaluate(() => ({
        fixture: window.startupFixture,
        text: document.body.innerText,
      })),
    );
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
