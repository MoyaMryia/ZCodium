import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/model-choice.jsx")],
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
      name: "private-component-fixture",
      setup(builder) {
        // Expose actual private controls only inside this test bundle.
        builder.onLoad({ filter: /SubagentsSection\.tsx$/ }, async ({ path }) => ({
          contents: `${await readFile(path, "utf8")}\nexport { SubagentForm as TestSubagentForm, SubagentModelOverrideControl as TestModelOverride };`,
          loader: "tsx",
          resolveDir: resolve(root, "packages/ui/src/settings"),
        }));
        builder.onResolve({ filter: /useStartPlanRecommendation|startPlanRecommendation/ }, () => {
          throw new Error("Retired recommendation dependencies must not enter the UI bundle");
        });
      },
    },
  ],
});
// 菜单的可见性与指针行为依赖正式样式；CI 与本地必须使用同一桌面构建产物。
const directory =
  process.env.ZCODE_TEST_RENDERER_ASSETS || resolve(root, "packages/desktop/out/renderer/assets");
const name = (await readdir(directory)).find((name) => /^styles-.*\.css$/.test(name));
assert.ok(name, "Build the desktop renderer before running the model choice browser test");
const css = await readFile(resolve(directory, name), "utf8");
const script = outputFiles.find((file) => file.path.endsWith(".js")) ?? outputFiles[0];
const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(script.contents);
  } else if (req.url === "/style.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end(
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
  const selectModel = async (name) => {
    await page.getByRole("menuitem", { name: "Fixture API", exact: true }).press("ArrowRight");
    await page.getByRole("menuitemradio", { name, exact: true }).press("Enter");
  };
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
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(
        `http://127.0.0.1:${server.address().port}/?locale=${locale}&theme=${width === 1280 ? "dark" : "light"}`,
      );
      const form = page.getByRole("region", { name: "User subagent" });
      const builtin = page.getByRole("region", { name: "Built-in subagent" });
      await form.getByRole("button", { name: "Model A", exact: true }).waitFor();
      await form.getByRole("button", { name: "Model A", exact: true }).press("Enter");
      await selectModel("Model B");
      await form
        .getByRole("button", { name: locale === "en-US" ? "Save" : "保存", exact: true })
        .press("Enter");
      await page.waitForFunction(() => window.modelChoiceFixture.saved.length === 1);
      assert.deepEqual(
        await page.evaluate(() => window.modelChoiceFixture.saved[0].modelSelection),
        {
          providerId: "fixture-api",
          modelId: "Model B",
          options: { reasoningLevel: "high" },
        },
      );
      await form.getByRole("button", { name: "Model B", exact: true }).click();
      await page
        .getByRole("menuitem", { name: locale === "en-US" ? "Inherit" : "继承默认", exact: true })
        .click();
      await form
        .getByRole("button", { name: locale === "en-US" ? "Save" : "保存", exact: true })
        .click();
      await page.waitForFunction(() => window.modelChoiceFixture.saved.length === 2);
      assert.equal(
        await page.evaluate(() =>
          Object.hasOwn(window.modelChoiceFixture.saved[1], "modelSelection"),
        ),
        false,
      );

      await page.evaluate(() => {
        window.modelChoiceFixture.failNext = true;
      });
      await builtin.getByRole("button", { name: "Model A", exact: true }).click();
      await selectModel("Model B");
      await page.waitForFunction(() => window.modelChoiceFixture.overrides.length === 1);
      await builtin.getByRole("button", { name: "Model A", exact: true }).waitFor();
      await builtin.getByRole("button", { name: "Model A", exact: true }).press("Enter");
      await selectModel("Model B");
      await builtin.getByRole("button", { name: "Model B", exact: true }).waitFor();
      await builtin.getByText("Model A", { exact: true }).waitFor({ state: "hidden" });
      assert.equal((await page.evaluate(() => window.modelChoiceFixture.overrides)).length, 2);
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(await page.getByText(/Start Plan|体验套餐/).count(), 0);
      if (process.env.ZCODE_TEST_SCREENSHOTS) {
        await mkdir(process.env.ZCODE_TEST_SCREENSHOTS, { recursive: true });
        await page.screenshot({
          path: resolve(process.env.ZCODE_TEST_SCREENSHOTS, `model-choice-${locale}-${width}.png`),
          fullPage: true,
        });
      }
    }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(
    "Model choice browser scenarios passed: explicit choice, inheritance, failed save and retry, EN/ZH, narrow/wide.",
  );
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
