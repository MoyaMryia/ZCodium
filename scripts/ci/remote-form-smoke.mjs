// Browser interaction coverage for the real remote form, state hook and target builder.
// Transport/native dialogs are test ports; remote installation has separate integration coverage.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "../..");
const { outputFiles } = await build({
  entryPoints: [resolve(import.meta.dirname, "fixtures/remote-form.jsx")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
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
      : '<!doctype html><meta name="viewport" content="width=device-width"><div id="root"></div><script src="/fixture.js"></script>',
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByTestId("ssh-host-input").fill("fixture.invalid");
    await page.getByTestId("ssh-username-input").fill("fixture");
    await page.getByTestId("ssh-password-input").fill("fixture-only-password");
    await page.getByRole("button", { name: "Submit fixture" }).click();
    let result = JSON.parse(await page.getByTestId("target").textContent());
    assert.equal(result.target.kind, "ssh");
    assert.equal(result.target.host, "fixture.invalid");
    assert.equal(result.target.username, "fixture");
    assert.equal(result.target.password, "fixture-only-password");
    assert.ok(!("assetInstallMode" in result.target));
    await page.getByTestId("ssh-auth-private-key").click();
    await page.getByTestId("ssh-private-key-input").fill("/fixture/id_ed25519");
    await page.getByRole("button", { name: "Submit fixture" }).click();
    result = JSON.parse(await page.getByTestId("target").textContent());
    assert.equal(result.target.privateKeyPath, "/fixture/id_ed25519");
    assert.ok(!result.target.password);
    assert.ok(!("assetInstallMode" in result.target));
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /Download locally|Download on remote|Resource download method|assetInstallMode/,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Remote form browser smoke passed: password/key, connection payload, desktop/mobile widths",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
