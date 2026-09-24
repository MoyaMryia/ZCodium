import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "zcodium-cli-entrypoints-"));
const binary = resolve(import.meta.dirname, "../../apps/zcode-cli/packages/cli/dist/zcode.cjs");
const execute = promisify(execFile);
async function run(args) {
  try {
    const result = await execute(process.execPath, [binary, ...args], {
      cwd: directory,
      env: {
        ...process.env,
        ZCODE_DATA_BASE_DIR: directory,
        XDG_CONFIG_HOME: directory,
        XDG_DATA_HOME: directory,
      },
      timeout: 15000,
    });
    return { ...result, code: 0 };
  } catch (error) {
    if (typeof error.code !== "number") throw error;
    return error;
  }
}
try {
  for (const locale of ["en-US", "zh-CN"]) {
    const help = await run(["help", "--locale", locale]);
    assert.equal(help.code, 0, help.stderr);
    assert.match(help.stdout, /--prompt/);
    assert.doesNotMatch(help.stdout, /\/login|\/logout|no-browser|login \[/);
    for (const args of [
      ["login", "fixture-private-key"],
      ["logout", "fixture-private-key"],
      ["--prompt", "/LOGIN fixture-private-key"],
    ]) {
      const result = await run([...args, "--locale", locale]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, locale === "zh-CN" ? /已移除/ : /removed/);
      assert.ok(!(result.stdout + result.stderr).includes("fixture-private-key"));
    }
  }
  console.log(
    "Built CLI: English/Chinese help and retired account commands passed without echoing arguments.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
