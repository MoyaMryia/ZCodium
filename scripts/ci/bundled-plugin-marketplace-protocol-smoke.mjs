import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const directory = await mkdtemp(join(tmpdir(), "zcodium-bundled-marketplace-"));
const binary = resolve(import.meta.dirname, "../../apps/zcode-cli/packages/cli/dist/zcode.cjs");
const networkLog = join(directory, "network-attempts.txt");
const guard = join(directory, "network-guard.cjs");
await writeFile(networkLog, "");
await writeFile(
  guard,
  `
const { appendFileSync } = require("node:fs");
function deny() { appendFileSync(${JSON.stringify(networkLog)}, "attempt\\n"); throw new Error("Unexpected network request in offline marketplace smoke"); }
globalThis.fetch = async () => deny();
for (const name of ["node:http", "node:https"]) { const mod = require(name); mod.request = deny; mod.get = deny; }
require("node:module").syncBuiltinESMExports();
`,
);
const child = spawn(process.execPath, ["--require", guard, binary, "app-server"], {
  cwd: directory,
  env: {
    ...process.env,
    ZCODE_DATA_BASE_DIR: directory,
    XDG_CONFIG_HOME: directory,
    XDG_DATA_HOME: directory,
  },
  stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.resume();
const closed = new Promise((done) => child.once("close", done));
const lines = createInterface({ input: child.stdout });
function request(id, method, params) {
  return new Promise((resolve, reject) => {
    const finish = (error, result) => {
      clearTimeout(timer);
      lines.off("line", onLine);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve(result);
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error(`CLI exited before response: ${code}`));
    const onLine = (line) => {
      try {
        const value = JSON.parse(line);
        if (value.id === id) finish(null, value);
      } catch (error) {
        finish(error);
      }
    };
    const timer = setTimeout(() => finish(new Error("CLI protocol response timed out")), 15000);
    lines.on("line", onLine);
    child.once("error", onError);
    child.once("exit", onExit);
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
}
try {
  const workspace = { workspacePath: directory, workspaceKey: directory };
  const overview = await request("catalog", "plugins/overview", { workspace });
  assert.equal(overview.error, undefined, JSON.stringify(overview));
  const catalog = overview.result.marketplaces.find((item) => item.id === "zcode-plugins-official");
  assert.deepEqual(catalog.source, { source: "bundled" });
  assert.ok(catalog.pluginCount > 0);
  assert.ok(overview.result.availablePlugins.length > 0);
  assert.doesNotMatch(JSON.stringify(overview.result.availablePlugins), /cdn-zcode/);
  for (const marketplace of ["zcode-plugins-official", undefined]) {
    const refreshed = await request(
      `refresh-${marketplace ?? "all"}`,
      "plugins/marketplace/update",
      { workspace, ...(marketplace ? { marketplace } : {}) },
    );
    assert.equal(refreshed.error, undefined, JSON.stringify(refreshed));
    assert.deepEqual(
      refreshed.result.diagnostics.filter((item) => item.severity === "error"),
      [],
    );
    assert.deepEqual(refreshed.result.marketplaces.find((item) => item.id === catalog.id).source, {
      source: "bundled",
    });
  }
  const again = await request("catalog-again", "plugins/overview", { workspace });
  assert.equal(again.error, undefined, JSON.stringify(again));
  assert.deepEqual(again.result.availablePlugins, overview.result.availablePlugins);
  assert.equal(await readFile(networkLog, "utf8"), "");
  console.log(
    "Built CLI seeded, listed and refreshed the bundled plugin catalog over stdio without network requests.",
  );
} finally {
  lines.close();
  child.kill();
  await closed;
  await rm(directory, { recursive: true, force: true });
}
