import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tsImport } from "tsx/esm/api";

const {
  createWorkspaceZCodeApp,
  deriveChildClientPorts,
  createZCodeAgentService,
  maybeStartSessionTitleGeneration,
} = await tsImport("./fixtures/local-model-requests.ts", import.meta.url);

test("workspace model assembly preserves isolation without installing Host account authentication", async () => {
  let options;
  const app = {};
  const workspace = {
    workspacePath: "/fixture/workspace",
    workspaceKey: "fixture-key",
    workspaceIdentity: "fixture-remote-identity",
    remoteSessionId: "fixture-attachment",
  };
  assert.equal(
    await createWorkspaceZCodeApp(
      {
        deps: {
          platform: "linux",
          createZCodeApp: async (input) => {
            options = input;
            return app;
          },
        },
      },
      workspace,
      { runtimeConfig: { workingDirectory: workspace.workspacePath } },
    ),
    app,
  );
  assert.equal(options.providerRuntimeHeadersPort, undefined);
  assert.equal(options.runtimeConfig.modelStreaming, "on");
  assert.equal(options.runtimeConfig.workspacePath, workspace.workspacePath);
  assert.equal(options.runtimeConfig.remoteSessionId, workspace.remoteSessionId);
  assert.equal(options.runtimeConfig.memory.workspaceIdentity, workspace.workspaceIdentity);
});

test("nested child permission routing retains root ownership and innermost origin without an identity header port", async () => {
  const requests = [];
  const root = new Proxy(
    {
      permissionBroker: {
        requestPermission: async (...args) => {
          requests.push(args);
          return { decision: "allow" };
        },
      },
    },
    {
      get(target, key) {
        assert.notEqual(key, "providerRuntimeHeadersPort");
        return target[key];
      },
    },
  );
  const child = deriveChildClientPorts(root, {
    parentSessionId: "root",
    childSessionId: "child",
    agentId: "child-agent",
    agentType: "fixture",
    description: "Fixture child",
  });
  const nested = deriveChildClientPorts(child, {
    parentSessionId: "child",
    childSessionId: "leaf",
    agentId: "leaf-agent",
    agentType: "fixture",
    description: "Fixture leaf",
  });
  const options = { signal: new AbortController().signal };
  const result = await nested.permissionBroker.requestPermission(
    {
      sessionId: "leaf",
      turnId: "leaf-turn",
      toolName: "AskUserQuestion",
      toolCallId: "fixture-tool",
      input: {},
    },
    options,
  );
  assert.equal(result.decision, "allow");
  assert.equal(requests[0][0].sessionId, "root");
  assert.equal(requests[0][0].origin.childSessionId, "leaf");
  assert.equal(requests[0][0].origin.agentId, "leaf-agent");
  assert.equal(requests[0][1], options);
});

test(
  "Host rejects the retired reverse request instead of reading official credentials",
  { timeout: 15000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "zcodium-model-host-"));
    const output = join(dir, "response.json");
    const child = join(dir, "agent.mjs");
    await writeFile(
      child,
      `
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
let request;
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.method) {
    request = message;
    send({ id: 'retired-auth', method: 'interaction/requestProviderRuntimeHeaders', params: {} });
  } else if (message.id === 'retired-auth') {
    await writeFile(process.argv[2], JSON.stringify(message));
    send({ id: request.id, error: { code: -32099, message: 'Fixture completed' } });
  }
}
`,
    );
    let service;
    try {
      service = createZCodeAgentService(
        new Proxy(
          {
            commandResolver: () => ({ command: process.execPath, args: [child, output], cwd: dir }),
            requestTimeoutMs: 5000,
          },
          {
            get(target, key) {
              assert.notEqual(
                key,
                "accountRequestAuthService",
                "Host must not read the retired dependency",
              );
              return target[key];
            },
          },
        ),
      );
      await assert.rejects(
        service.getTaskTokenUsage({ workspacePath: dir, sessionId: "fixture" }),
        /Fixture completed/,
      );
      assert.equal(JSON.parse(await readFile(output, "utf8")).error.code, -32601);
    } finally {
      await service?.disposeAllAndWait();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("title generation retains short-input and one-attempt guards without waiting for Host identity", async () => {
  const jobs = [];
  const runtime = new Proxy(
    {
      sessionId: "fixture-session",
      turnNumber: 0,
      config: { titleGeneration: { enabled: true }, taskType: "interactive" },
      sessionStore: { getSession: async () => null },
      trackResidencyBlockingWork: (job) => {
        jobs.push(job);
        return job;
      },
    },
    {
      get(target, key) {
        assert.notEqual(key, "providerRuntimeHeadersPort");
        return target[key];
      },
    },
  );
  const start = (text) =>
    maybeStartSessionTitleGeneration.call(
      runtime,
      text,
      "fixture-message",
      {},
      { deferIfProviderRuntimeHeadersRefresh: true },
    );
  assert.equal(start("hi"), false);
  assert.equal(start("Fixture question with enough text"), true);
  assert.equal(start("Fixture question with enough text"), false);
  await Promise.all(jobs);
  assert.equal(jobs.length, 1);
});
