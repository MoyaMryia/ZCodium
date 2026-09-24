import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { tsImport } from "tsx/esm/api";

const {
  AiSdkModelAdapter,
  runWithModelInvocationContext,
  ModelErrorCode,
  AiSdkModelExecution,
  createGenerateTextOptions,
  createStreamTextOptions,
} = await tsImport("./fixtures/local-model-requests.ts", import.meta.url);

const modelOptions = { maxOutputTokens: 64, reasoningLevel: "disabled" };
const modelConfig = {
  enabled: true,
  properties: {
    contextWindow: 8192,
    requiresMfjsToolSchema: false,
    inputFormat: {
      supportsText: true,
      supportsImage: false,
      supportsVideo: false,
      supportsAudio: false,
      supportsPdf: false,
    },
    outputFormat: { supportsText: true },
    supportsToolCall: true,
    supportsJsonSchemaOutput: false,
    supportsNativeWebSearch: false,
    supportsMidConversationSystem: true,
  },
  optionSpecs: {
    reasoningLevel: { values: ["disabled"], map: "{}" },
    maxOutputTokens: { max: 128, map: "{'max_tokens': maxOutputTokens}" },
  },
};

test("generate and stream requests use explicit user headers without adding private attribution", () => {
  const headers = { "x-session-id": "user-defined-value", "X-Fixture": "user-header" };
  for (const makeOptions of [createGenerateTextOptions, createStreamTextOptions]) {
    const options = makeOptions({
      request: { messages: [] },
      resolved: {
        model: {},
        headers,
        properties: modelConfig.properties,
        providerKind: "openai-compatible",
        providerId: "fixture",
        modelId: "fixture",
        baseURL: "https://opencode.ai/zen/go/v1",
      },
      statusContext: {
        requestId: "fixture-request",
        traceId: "fixture-trace",
        sessionId: "sess_fixture-session",
        queryId: "query_fixture-query",
        modelRequestSessionType: "main",
      },
    });
    assert.deepEqual(options.headers, headers);
  }
});

test("user-selected model endpoints reach their own transport without an official gateway rewrite", async () => {
  for (const baseUrl of [
    "https://api.z.ai/api/anthropic/v1",
    "https://open.bigmodel.cn/api/anthropic/v1",
  ]) {
    const urls = [];
    const execution = new AiSdkModelExecution(
      { env: {} },
      {
        transport: async (input) => {
          urls.push(input instanceof Request ? input.url : String(input));
          throw new Error("Fixture transport boundary");
        },
      },
    );
    const bound = execution
      .bindModel({
        providerId: "fixture",
        modelId: "fixture-model",
        providerConfig: {
          group: "standard-personal",
          access: { type: "api-key", apiKey: "fixture-key" },
          api: { type: "anthropic-messages", baseUrl },
        },
        optionSpecs: modelConfig.optionSpecs,
        supportsJsonSchemaOutput: false,
      })
      .resolveRequest({ options: modelOptions });
    await assert.rejects(
      bound.model.doGenerate({
        prompt: [{ role: "user", content: [{ type: "text", text: "Fixture" }] }],
      }),
      /Fixture transport boundary/,
    );
    assert.deepEqual(urls, [`${baseUrl}/messages`]);
  }
});

test(
  "self-managed HTTP model keeps user credentials, retry and cancellation without Host identity refresh",
  { timeout: 15000 },
  async () => {
    const requests = [];
    let holdResponse = false;
    let requestReceived;
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
        /* consume the fixture body */
      }
      requests.push(req.headers);
      if (holdResponse) {
        requestReceived();
        return;
      }
      if (requests.length === 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Fixture temporary failure" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "fixture-model",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Fixture answer" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        }),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const adapter = new AiSdkModelAdapter({
      env: {},
      retry: { maxAttempts: 2, baseDelayMs: 0, jitter: false },
    });
    const providerConfig = {
      group: "standard-personal",
      api: {
        type: "openai-chat-completions",
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        headers: { "X-Fixture-User": "fixture-header" },
      },
      access: { type: "api-key", apiKey: "fixture-user-key" },
    };
    const createModel = (access = providerConfig.access) =>
      adapter.createModel({
        providerId: "fixture-api",
        modelId: "fixture-model",
        providerConfig: { ...providerConfig, access },
        modelConfig,
        options: modelOptions,
      });
    const prompt = { messages: [{ role: "user", content: "Fixture question" }] };
    let refreshes = 0;
    const invocation = {
      refreshRuntimeHeadersBeforeAttempt: async () => {
        refreshes++;
        throw new Error("Retired Host callback");
      },
    };
    try {
      const model = createModel();
      const result = await runWithModelInvocationContext(invocation, () =>
        model.generateText(prompt),
      );
      assert.equal(result.text, "Fixture answer");
      assert.equal(requests.length, 2);
      for (const headers of requests) {
        assert.equal(headers.authorization, "Bearer fixture-user-key");
        assert.equal(headers["x-fixture-user"], "fixture-header");
        assert.ok(
          Object.keys(headers).every((name) => !/device|zcode|zhipu|account/.test(name)),
          Object.keys(headers).join(", "),
        );
      }
      const controller = new AbortController();
      controller.abort(new Error("Fixture cancelled"));
      await assert.rejects(
        model.generateText({ ...prompt, abortSignal: controller.signal }),
        (error) => error.code === ModelErrorCode.ModelRequestCancelled,
      );
      assert.equal(requests.length, 2);
      holdResponse = true;
      const received = new Promise((resolve) => {
        requestReceived = resolve;
      });
      const pendingController = new AbortController();
      const cancelled = assert.rejects(
        model.generateText({ ...prompt, abortSignal: pendingController.signal }),
        (error) => error.code === ModelErrorCode.ModelRequestCancelled,
      );
      await received;
      pendingController.abort(new Error("Fixture cancelled in flight"));
      await cancelled;
      assert.equal(requests.length, 3);
      const accountModel = createModel({
        type: "zhipu-account",
        accountType: "individual",
        mode: "normal",
        entitled: true,
      });
      await assert.rejects(
        runWithModelInvocationContext(invocation, () => accountModel.generateText(prompt)),
        (error) => error.code === ModelErrorCode.ModelRequestAuthMissing,
      );
      assert.equal(refreshes, 0);
      assert.equal(requests.length, 3);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test(
  "streaming model keeps local status and usage without sending session identifiers",
  { timeout: 15000 },
  async () => {
    const requests = [];
    const statuses = [];
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
        /* consume the fixture body */
      }
      requests.push(req.headers);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (choices, usage) =>
        res.write(
          `data: ${JSON.stringify({
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture-model",
            choices,
            usage,
          })}\n\n`,
        );
      chunk([
        { index: 0, delta: { role: "assistant", content: "Fixture stream" }, finish_reason: null },
      ]);
      chunk([{ index: 0, delta: {}, finish_reason: "stop" }]);
      chunk([], { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
      res.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const adapter = new AiSdkModelAdapter({
      env: {},
      statusSink: { publish: (event) => statuses.push(event) },
    });
    const model = adapter.createModel({
      providerId: "fixture-api",
      modelId: "fixture-model",
      providerConfig: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture-key" },
        api: {
          type: "openai-chat-completions",
          baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        },
      },
      modelConfig,
      options: modelOptions,
    });
    try {
      const events = await runWithModelInvocationContext(
        {
          traceContext: {
            traceId: "fixture-trace",
            sessionId: "fixture-session",
            queryId: "fixture-query",
          },
        },
        async () =>
          Array.fromAsync(model.streamText({ messages: [{ role: "user", content: "Fixture" }] })),
      );
      assert.equal(
        events
          .filter((event) => event.type === "text_delta")
          .map((event) => event.text)
          .join(""),
        "Fixture stream",
      );
      assert.ok(statuses.some((event) => event.type === "model_request_started"));
      const completed = statuses.find((event) => event.type === "model_request_completed");
      assert.ok(completed);
      assert.equal(completed.traceId, "fixture-trace");
      assert.equal(completed.sessionId, "fixture-session");
      assert.equal(completed.usage.totalTokens, 5);
      assert.equal(events.find((event) => event.type === "finish").usage.totalTokens, 5);
      assert.ok(completed.durationMs >= 0);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].authorization, "Bearer fixture-key");
      for (const name of [
        "x-zcode-trace-id",
        "x-request-id",
        "x-session-id",
        "x-query-id",
        "x-zcode-session-type",
        "x-opencode-session",
      ]) {
        assert.equal(requests[0][name], undefined, name);
      }
      assert.ok(!JSON.stringify(requests).includes("fixture-session"));
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
