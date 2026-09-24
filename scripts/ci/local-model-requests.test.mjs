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
  createRuntimeAiSdkModelExecutionConfig,
  createModelAdapter,
} = await tsImport("./fixtures/local-model-requests.ts", import.meta.url);

function assertNoImplicitClientMetadata(headers) {
  for (const name of [
    "http-referer",
    "x-title",
    "x-release-channel",
    "x-client-language",
    "x-client-timezone",
    "x-zcode-agent",
    "x-zcode-app-version",
    "x-platform",
    "x-os-category",
    "x-os-version",
  ]) {
    assert.equal(headers[name], undefined, name);
  }
  assert.ok(!headers["user-agent"]?.includes("ZCode/"));
}

test("runtime model config preserves network settings without collecting client metadata", (t) => {
  const env = new Proxy(
    {},
    {
      get() {
        throw new Error("Client metadata environment must not be read");
      },
    },
  );
  t.mock.method(Intl, "DateTimeFormat", () => {
    throw new Error("Locale and timezone must not be collected");
  });
  const network = {
    httpProxy: "http://fixture.invalid:8080",
    noProxy: "localhost",
    caCertFile: "fixture-ca.pem",
  };
  const config = createRuntimeAiSdkModelExecutionConfig(env, { network });
  assert.equal(config.env, env);
  assert.deepEqual(config.network, network);
  assert.equal(config.defaultHeaders, undefined);
  assert.equal(createRuntimeAiSdkModelExecutionConfig(env).network, undefined);
});

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
      ...createRuntimeAiSdkModelExecutionConfig({ ZCODE_APP_VERSION: "99.0.0-fixture" }),
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
        assertNoImplicitClientMetadata(headers);
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
      assert.throws(
        () =>
          createModel({
            type: "zhipu-account",
            accountType: "individual",
            mode: "normal",
            entitled: true,
          }),
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
    const adapter = createModelAdapter({
      env: {},
      executionConfig: createRuntimeAiSdkModelExecutionConfig({
        ZCODE_APP_VERSION: "99.0.0-fixture",
      }),
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
      assertNoImplicitClientMetadata(requests[0]);
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

test("retired account providers cannot bind even with a supplied ticket source", () => {
  const accessModes = [
    "normal",
    "start-plan",
    "individual-coding-plan",
    "team-coding-plan",
    "off-peak",
  ];
  for (const mode of accessModes) {
    let accessed = false;
    const forbidden = () => {
      accessed = true;
      throw new Error("Retired credential or transport accessed");
    };
    const input = {
      providerId: "fixture-account",
      modelId: "fixture-model",
      providerConfig: {
        group: "standard-personal",
        access: { type: "zhipu-account", accountType: "individual", mode, entitled: true },
        api: { type: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1" },
      },
      modelConfig,
      options: modelOptions,
      requestDependencies: new Proxy({}, { get: forbidden }),
    };
    const execution = new AiSdkModelExecution({ env: {} }, { transport: forbidden });
    assert.throws(
      () =>
        execution.bindModel({
          ...input,
          supportsJsonSchemaOutput: false,
          optionSpecs: modelConfig.optionSpecs,
        }),
      (error) => error.code === ModelErrorCode.ModelRequestAuthMissing,
    );
    const adapter = new AiSdkModelAdapter({
      env: {},
      runtime: { generateText: forbidden, streamText: forbidden },
    });
    assert.throws(
      () => adapter.createModel(input),
      (error) => error.code === ModelErrorCode.ModelRequestAuthMissing,
    );
    assert.equal(accessed, false);
  }
});

test(
  "self-managed 429 with a legacy business code respects bounded retry in generate and stream",
  { timeout: 15000 },
  async () => {
    let requests = 0;
    const statuses = [];
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
      }
      requests++;
      assert.equal(req.headers.authorization, "Bearer fixture-key");
      assert.equal(req.headers["x-fixture-user"], "explicit");
      assert.equal(req.headers["x-off-peak-ticket-id"], undefined);
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "0" });
      res.end(JSON.stringify({ error: { code: "3105", message: "Fixture rate limit" } }));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const model = new AiSdkModelAdapter({
        env: {},
        retry: { maxAttempts: 2, baseDelayMs: 0, jitter: false },
        statusSink: { publish: (event) => statuses.push(event) },
      }).createModel({
        providerId: "fixture-api",
        modelId: "fixture-model",
        providerConfig: {
          group: "standard-personal",
          access: { type: "api-key", apiKey: "fixture-key" },
          api: {
            type: "openai-chat-completions",
            baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
            headers: { "X-Fixture-User": "explicit" },
          },
        },
        modelConfig,
        options: modelOptions,
      });
      const prompt = { messages: [{ role: "user", content: "Fixture instructions" }] };
      await assert.rejects(
        model.generateText(prompt),
        (error) => error.code === ModelErrorCode.ModelRateLimited,
      );
      assert.equal(requests, 2);
      await assert.rejects(
        Array.fromAsync(model.streamText(prompt)),
        (error) => error.code === ModelErrorCode.ModelRateLimited,
      );
      assert.equal(requests, 4);
      assert.ok(statuses.some((s) => s.type === "model_retry_scheduled"));
      assert.equal(
        statuses.some((s) => s.reason === "offpeak_queued"),
        false,
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

test("SSE error chunks preserve retry limits, visible-output boundary and iterator cleanup", async () => {
  for (const mode of ["throw", "chunk", "visible"]) {
    const visible = mode === "visible";
    let attempts = 0,
      closed = 0;
    const statuses = [];
    const model = new AiSdkModelAdapter({
      env: {},
      retry: { maxAttempts: 2, baseDelayMs: 0, jitter: false },
      statusSink: { publish: (event) => statuses.push(event) },
      runtime: {
        generateText() {
          throw new Error("Unexpected non-streaming call");
        },
        streamText() {
          attempts++;
          if (mode === "throw")
            throw Object.assign(new Error("Fixture rate limit"), {
              statusCode: 429,
              responseHeaders: { "retry-after": "0" },
            });
          return {
            fullStream: (async function* () {
              try {
                if (visible) yield { type: "text-delta", id: "fixture", text: "Fixture partial" };
                yield {
                  type: "error",
                  error: Object.assign(new Error("Fixture rate limit"), {
                    statusCode: 429,
                    responseHeaders: { "retry-after": "0" },
                  }),
                };
              } finally {
                closed++;
              }
            })(),
          };
        },
      },
    }).createModel({
      providerId: "fixture-api",
      modelId: "fixture-model",
      providerConfig: {
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture-key" },
        api: { type: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1" },
      },
      modelConfig,
      options: modelOptions,
    });
    const events = [];
    await assert.rejects(
      async () => {
        for await (const event of model.streamText({
          messages: [{ role: "user", content: "Fixture instructions" }],
        }))
          events.push(event);
      },
      (error) => error.code === ModelErrorCode.ModelRateLimited,
    );
    assert.equal(attempts, visible ? 1 : 2);
    assert.equal(closed, mode === "throw" ? 0 : attempts);
    assert.equal(events.filter((e) => e.type === "text_delta").length, visible ? 1 : 0);
    assert.equal(
      statuses.filter((s) => s.type === "model_retry_scheduled").length,
      visible ? 0 : 1,
    );
  }
});
