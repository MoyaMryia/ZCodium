import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const directory = await mkdtemp(join(tmpdir(), "zcodium-local-automation-"));
const binary = resolve(import.meta.dirname, "../../apps/zcode-cli/packages/cli/dist/zcode.cjs");
const child = spawn(process.execPath, [binary, "app-server"], {
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
try {
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CLI protocol response timed out")), 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`CLI exited before response: ${code}`));
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (value.id !== "retired-idle-policy") return;
        clearTimeout(timer);
        resolve(value);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
  child.stdin.write(
    JSON.stringify({
      id: "retired-idle-policy",
      method: "workspace/updateOffPeakToolPolicy",
      params: { workspace: { path: directory }, enabled: true },
    }) + "\n",
  );
  const result = await response;
  assert.equal(
    result.error?.code,
    -32601,
    "Built CLI must reject the retired idle-time policy method",
  );
  console.log("Built CLI rejects retired idle-time policy; no session or model is needed.");
} finally {
  child.kill();
  await closed;
  await rm(directory, { recursive: true, force: true });
}
