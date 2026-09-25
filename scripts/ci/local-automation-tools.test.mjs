import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { registerBuiltInTools, ToolRegistryImpl } = await tsImport(
  "./fixtures/local-automation-tools.ts",
  import.meta.url,
);
const { commandPayloadSchemas } = await tsImport(
  "../../packages/shared/src/zcode-protocol-v4/command.ts",
  import.meta.url,
);

test("retired idle-time tools cannot be registered through an old feature flag", () => {
  const registry = new ToolRegistryImpl();
  registerBuiltInTools(registry, { includeAutomation: true, includeOffPeak: true });
  for (const name of ["OffPeakCreate", "OffPeakList"]) assert.equal(registry.has(name), false);
  for (const name of ["CronCreate", "CronList", "CronUpdate", "CronDelete"])
    assert.equal(registry.has(name), true);
});

test("local cron list keeps its workspace port without official idle-time dependencies", async () => {
  const registry = new ToolRegistryImpl();
  registerBuiltInTools(registry, { includeAutomation: true });
  let calls = 0;
  const result = await registry.get("CronList").handler(
    {},
    new Proxy(
      {
        automationPort: {
          async list() {
            calls++;
            return [];
          },
        },
      },
      {
        get(target, key) {
          assert.notEqual(key, "offPeakPort");
          return target[key];
        },
      },
    ),
  );
  assert.deepEqual(result, { automations: [] });
  assert.equal(calls, 1);
});

test("V4 session creation strips a retired idle-time tool flag", () => {
  const result = commandPayloadSchemas.createSession.parse({
    workspaceId: "fixture-workspace",
    offPeakToolEnabled: true,
  });
  assert.equal(Object.hasOwn(result, "offPeakToolEnabled"), false);
});

test("SendMessage uses its ordinary child port without retired idle execution context", async () => {
  const registry = new ToolRegistryImpl();
  registerBuiltInTools(registry, { includeSendMessage: true });
  let sent = 0;
  const entry = registry.get("SendMessage");
  const input = { to: "fixture-agent", summary: "Fixture summary", message: "Fixture message" };
  const context = {
    toolCallId: "fixture-call",
    sessionId: "fixture-session",
    turnId: "fixture-turn",
    traceId: "fixture-trace",
    subagentPort: {
      async sendMessage() {
        sent++;
        return { success: true, message: "Fixture sent" };
      },
    },
  };
  assert.equal((await entry.handler(input, context)).success, true);
  assert.equal(sent, 1);
});
