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
  const result = await request("retired-idle-policy", "workspace/updateOffPeakToolPolicy", {
    workspace: { path: directory },
    enabled: true,
  });
  assert.equal(result.error?.code, -32601);
  const selection = { providerId: "fixture-api", modelId: "fixture-model" };
  const patches = [
    { offPeakTaskId: "offpeak-old" },
    {
      modelExecution: {
        selectionScope: "execution",
        requestAuth: { headers: { "X-Off-Peak-Ticket-ID": "fixture-ticket" } },
      },
    },
  ];
  for (const [index, patch] of patches.entries()) {
    const legacy = await request(`legacy-${index}`, "session/send", {
      sessionId: "fixture-absent",
      content: "Fixture instructions",
      modelSelection: selection,
      ...patch,
    });
    assert.equal(
      legacy.error?.code,
      -32602,
      "Legacy must reject invalid params before session/model lookup",
    );
    const v4 = await request(`v4-${index}`, "v4/command", {
      commandId: `fixture-${index}`,
      clientId: "fixture-client",
      sessionId: "fixture-absent",
      type: "sendText",
      issuedAt: 1,
      payload: { text: "Fixture instructions", modelSelection: selection, ...patch },
    });
    assert.equal(v4.result?.status, "rejected", JSON.stringify(v4));
    assert.equal(v4.result?.reasonCode, "proto.invalidPayload");
  }
  const prefix = await request("retired-prefix", "v4/command", {
    commandId: "offpeak-old:resume:fixture",
    clientId: "fixture-client",
    sessionId: "fixture-absent",
    type: "sendText",
    issuedAt: 1,
    payload: { text: "Fixture instructions" },
  });
  assert.equal(prefix.result?.reasonCode, "proto.invalidPayload", JSON.stringify(prefix));
  console.log(
    "Built CLI rejects retired idle policy, dispatch fields, tickets and resume IDs before session/model lookup.",
  );
} finally {
  lines.close();
  child.kill();
  await closed;
  await rm(directory, { recursive: true, force: true });
}
