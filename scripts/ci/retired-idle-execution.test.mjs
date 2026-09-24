import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { zcodeSessionSendParamsSchema } = await tsImport(
  "../../packages/shared/src/zcode-protocol/index.ts",
  import.meta.url,
);
const { parseCommandEnvelope } = await tsImport(
  "../../packages/shared/src/zcode-protocol-v4/command.ts",
  import.meta.url,
);
const selection = { providerId: "fixture-api", modelId: "fixture-model" };
const envelope = (payload, commandId = "fixture-input") => ({
  commandId,
  clientId: "fixture-client",
  sessionId: "fixture-session",
  type: "sendText",
  issuedAt: 1,
  payload: { text: "Fixture instructions", modelSelection: selection, ...payload },
});

test("legacy send rejects retired idle fields, tickets and fallback identities", () => {
  const base = {
    sessionId: "fixture-session",
    content: "Fixture instructions",
    modelSelection: selection,
  };
  for (const patch of [
    { offPeakTaskId: "offpeak-old" },
    { offPeakRunType: "resume" },
    { inputId: "offpeak-old:resume:fixture" },
    { queryId: "offpeak-old:resume:fixture" },
    { toolDenylist: ["OffPeakCreate"] },
    {
      modelExecution: {
        selectionScope: "execution",
        requestAuth: {
          apiKey: "fixture-secret",
          headers: { "X-Off-Peak-Ticket-ID": "fixture-ticket" },
        },
      },
    },
  ])
    assert.equal(
      zcodeSessionSendParamsSchema.safeParse({ ...base, ...patch }).success,
      false,
      JSON.stringify(Object.keys(patch)),
    );
  assert.equal(
    zcodeSessionSendParamsSchema.safeParse({
      ...base,
      automationId: "automation-fixture",
      inputId: "automation-fixture:run",
      toolDenylist: ["CronCreate"],
    }).success,
    true,
  );
});

test("V4 rejects old dispatch before admission while normal and cron commands remain valid", () => {
  for (const patch of [
    { offPeakTaskId: "offpeak-old" },
    { offPeakRunType: "init" },
    { toolDisallowlist: ["OffPeakCreate"] },
    {
      modelExecution: {
        selectionScope: "execution",
        requestAuth: { headers: { "X-Off-Peak-Ticket-ID": "fixture-ticket" } },
      },
    },
  ])
    assert.equal(
      parseCommandEnvelope(envelope(patch)).ok,
      false,
      JSON.stringify(Object.keys(patch)),
    );
  assert.equal(parseCommandEnvelope(envelope({}, "offpeak-old:resume:fixture")).ok, false);
  for (const patch of [
    {},
    { automationId: "automation-fixture" },
    {
      modelExecution: {
        selectionScope: "execution",
        memoryExtraction: "skip",
        subagents: { foregroundModel: "submission", background: "deny" },
      },
    },
  ])
    assert.equal(parseCommandEnvelope(envelope(patch)).ok, true);
});

const { CommandInbox, startPromptTurn, createModelExecutionContext, bashToolEntry } =
  await tsImport("./fixtures/retired-idle-execution.ts", import.meta.url);

test("actual CommandInbox rejects retired requests without reading or writing session state", async () => {
  const inbox = new CommandInbox(
    new Proxy(
      {},
      {
        get(_target, key) {
          throw new Error(`Unexpected state access: ${String(key)}`);
        },
      },
    ),
  );
  for (const input of [
    envelope({ offPeakTaskId: "offpeak-old" }),
    envelope({}, "offpeak-old:resume:fixture"),
    envelope({ toolDisallowlist: ["OffPeakCreate"] }),
    envelope({
      modelExecution: { selectionScope: "execution", requestAuth: { apiKey: "fixture-secret" } },
    }),
  ]) {
    const result = await inbox.handle(input);
    assert.equal(result.kind, "ack");
    assert.equal(result.ack.status, "rejected");
    assert.equal(result.ack.reasonCode, "proto.invalidPayload");
  }
});

test("ordinary and scheduled turns preserve admission, denylist and completion ownership", async () => {
  for (const automation of [false, true]) {
    let complete, received;
    const completion = new Promise((resolve) => {
      complete = resolve;
    });
    const priorBot = { kind: "fixture-previous-bot" };
    const currentBot = { kind: "fixture-current-bot" };
    const changes = [];
    const record = {
      persistence: "immediate",
      activeBotDeliveryTarget: priorBot,
      app: {
        sessionId: "fixture-session",
        async sendInput(input, options) {
          received = { input, options };
          return { kind: "started_turn", completion };
        },
      },
    };
    const host = {
      ensureModelReady: async () => {},
      afterLegacyStateMutation: async (_record, reason) => changes.push(reason),
    };
    const result = await startPromptTurn(host, record, {
      inputId: automation ? "automation-fixture:run" : "fixture-input",
      content: "Fixture instructions",
      botDeliveryTarget: currentBot,
      toolDisallowlist: ["FixtureUserDeniedTool"],
    });
    assert.equal(record.activeBotDeliveryTarget, currentBot);
    assert.equal(record.residencyFinalizationCount, 1);
    assert.equal(received.options.automationId, automation ? "automation-fixture" : undefined);
    assert.deepEqual(
      received.options.toolDisallowlist,
      automation
        ? ["FixtureUserDeniedTool", "CronCreate", "CronUpdate", "CronDelete"]
        : ["FixtureUserDeniedTool"],
    );
    assert.equal("offPeakTaskId" in received.options, false);
    complete();
    await result.completion;
    assert.equal(record.activeAutomationId, undefined);
    assert.equal(record.activeBotDeliveryTarget, priorBot);
    assert.equal(record.residencyFinalizationCount, 0);
    assert.deepEqual(changes, ["prompt_completed"]);
  }
});

test("failed and queued admissions restore existing cron and Bot scope", async () => {
  for (const kind of ["throw", "rejected", "queued"]) {
    const priorBot = { kind: "fixture-bot" };
    const record = {
      persistence: "immediate",
      activeAutomationId: "automation-previous",
      activeBotDeliveryTarget: priorBot,
      app: {
        sessionId: "fixture-session",
        async sendInput() {
          if (kind === "throw") throw new Error("Fixture admission failure");
          return { kind, reason: "busy" };
        },
      },
    };
    const host = { ensureModelReady: async () => {} };
    const start = () =>
      startPromptTurn(host, record, {
        inputId: "automation-fixture:run",
        content: "Fixture instructions",
      });
    if (kind === "queued") assert.equal((await start()).admission.kind, "queued");
    else await assert.rejects(start);
    assert.equal(record.activeAutomationId, "automation-previous");
    assert.equal(record.activeBotDeliveryTarget, priorBot);
    assert.equal("activeOffPeakTaskId" in record, false);
  }
});

test("execution projection never constructs a ticket credential supplier", () => {
  const input = {
    selectionScope: "execution",
    memoryExtraction: "skip",
    subagents: { foregroundModel: "submission", background: "deny" },
    requestAuth: { apiKey: "fixture-secret" },
  };
  assert.deepEqual(createModelExecutionContext(input), {
    selectionScope: "execution",
    memoryExtraction: "skip",
    subagents: input.subagents,
  });
});

test("Bash retains explicit and timeout background modes without idle context reads", async () => {
  for (const explicit of [false, true]) {
    let mode;
    const result = await bashToolEntry.handler(
      { command: "echo fixture", ...(explicit ? { run_in_background: true } : {}) },
      new Proxy(
        {
          workingDirectory: process.cwd(),
          workspaceRoot: process.cwd(),
          toolCallId: "fixture-call",
          sessionId: "fixture-session",
          turnId: "fixture-turn",
          traceId: "fixture-trace",
          executionPort: {
            async runBashWithBackgroundLifecycle(_request, lifecycle) {
              mode = lifecycle.mode;
              return {
                kind: "backgrounded",
                task: { taskId: "fixture-background", outputPath: "fixture-output" },
              };
            },
          },
        },
        {
          get(target, key) {
            assert.notEqual(key, "offPeakTurn");
            return target[key];
          },
        },
      ),
    );
    assert.equal(mode, explicit ? "explicit" : "auto_on_timeout");
    assert.equal(result.status, "backgrounded");
    assert.equal(result.backgroundTaskId, "fixture-background");
  }
});

test("Host facades reject deprecated identity before parameter projection or side effects", async () => {
  const { createZCodeAgentService } = await tsImport(
    "../../packages/services/src/zcode-agent/zcodeAgentService.ts",
    import.meta.url,
  );
  const { createZCodeTaskServiceAdapter } = await tsImport(
    "../../packages/services/src/zcode-agent/zcodeTaskServiceAdapter.ts",
    import.meta.url,
  );
  let accessed = false;
  const forbidden = () => {
    accessed = true;
    throw new Error("Unexpected Host side effect");
  };
  const agent = createZCodeAgentService({ commandResolver: forbidden });
  const adapter = createZCodeTaskServiceAdapter({
    zcodeAgentService: { disposeAll() {} },
    taskIndexRepo: new Proxy(
      { close() {} },
      {
        get(target, key) {
          if (key === "close") return target.close;
          return forbidden();
        },
      },
    ),
    taskIndexSyncer: {
      onSessionTerminalEvent: () => ({ dispose() {} }),
      onSessionReadyEvent: () => ({ dispose() {} }),
      disposeAll() {},
    },
  });
  try {
    for (const patch of [
      { offPeakTaskId: "offpeak-old" },
      { offPeakRunType: "resume" },
      {
        modelExecution: { selectionScope: "execution", requestAuth: { apiKey: "fixture-secret" } },
      },
    ]) {
      const params = {
        ...patch,
        workspacePath: process.cwd(),
        sessionId: "fixture-session",
        taskId: "fixture-task",
        content: "Fixture instructions",
      };
      for (const send of [
        () => agent.sendPrompt(params),
        () => adapter.createTask(params),
        () => adapter.sendPrompt(params),
        () => adapter.resumeTask(params),
      ])
        await assert.rejects(send, (error) => error.name === "ZodError");
    }
    assert.equal(accessed, false);
  } finally {
    adapter.disposeAll();
    await agent.disposeAllAndWait();
  }
});
