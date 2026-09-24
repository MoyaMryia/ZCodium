import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { tsImport } from "tsx/esm/api";
import { modelOptions, modelConfig } from "./fixtures/local-model-config.mjs";

const { AiSdkModelAdapter, AiSdkModelExecution, ModelErrorCode } = await tsImport(
  "./fixtures/local-model-requests.ts",
  import.meta.url,
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
