import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { createDiagnosticsExporter } = await tsImport(
  "../../packages/shared/src/node/diagnosticsExport.ts",
  import.meta.url,
);

test("export is inert by default including legacy and endpoint-only environment", async () => {
  for (const env of [
    {},
    { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
    { ZCODE_TELEMETRY_ENABLED: "1", ZCODE_TELEMETRY_REPORT_ENDPOINT: "https://private.invalid" },
  ]) {
    let calls = 0;
    const exporter = createDiagnosticsExporter({
      env,
      fetch: async () => {
        calls++;
        throw new Error("unexpected");
      },
    });
    assert.equal(exporter.enabled, false);
    assert.equal(exporter.record({ name: "ttft", metrics: { durationMs: 10 } }), false);
    await exporter.shutdown();
    assert.equal(calls, 0);
  }
});

test("explicit user OTLP export retains measurements and random association without resource identity", async () => {
  const calls = [];
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://user-collector.invalid/prefix",
      OTEL_RESOURCE_ATTRIBUTES: "user.id=PRIVATE",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20SECRET",
    },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    },
  });
  assert.equal(exporter.enabled, true);
  const traceId = "a".repeat(32);
  assert.equal(
    exporter.record({
      name: "ttft",
      traceId,
      spanId: "b".repeat(16),
      metrics: { durationMs: 42, queueMs: 3 },
    }),
    true,
  );
  assert.equal(exporter.record({ name: "ttft", prompt: "PRIVATE" }), false);
  await exporter.shutdown();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://user-collector.invalid/prefix/v1/logs");
  assert.equal(calls[0].init.redirect, "error");
  const body = JSON.parse(calls[0].init.body);
  const resource = body.resourceLogs[0];
  assert.deepEqual(resource.resource.attributes, [
    { key: "service.name", value: { stringValue: "ZCodium" } },
  ]);
  const record = resource.scopeLogs[0].logRecords[0];
  assert.equal(record.traceId, traceId);
  assert.ok(
    record.attributes.some(
      (item) => item.key === "zcodium.durationMs" && item.value.doubleValue === 42,
    ),
  );
  assert.ok(record.observedTimeUnixNano);
  assert.ok(!JSON.stringify(body).includes("PRIVATE"));
  assert.ok(!JSON.stringify(body).includes("SECRET"));
  assert.equal(exporter.record({ name: "error" }), false);
});

test("queue is bounded, failure does not propagate, shutdown releases records", async () => {
  let calls = 0;
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    },
    fetch: async () => {
      calls++;
      throw new Error("PRIVATE endpoint response");
    },
  });
  let accepted = 0;
  for (let i = 0; i < 400; i++)
    if (exporter.record({ name: "process.resource", metrics: { rssBytes: 100 } })) accepted++;
  assert.equal(accepted, 256);
  await exporter.shutdown();
  assert.equal(calls, 1);
  await exporter.shutdown();
  assert.equal(calls, 1);
});

test("concurrent shutdown callers drain both current and queued batches", async () => {
  const pending = [];
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    },
    fetch: () => new Promise((resolve) => pending.push(() => resolve(new Response("{}")))),
  });
  exporter.record({ name: "startup" });
  const first = exporter.flush();
  exporter.record({ name: "ttft" });
  let doneA = false,
    doneB = false;
  const a = exporter.shutdown().then(() => {
    doneA = true;
  });
  const b = exporter.shutdown().then(() => {
    doneB = true;
  });
  assert.equal(pending.length, 1);
  pending[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 2);
  assert.equal(doneA, false);
  assert.equal(doneB, false);
  pending[1]();
  await Promise.all([first, a, b]);
  assert.equal(doneA, true);
  assert.equal(doneB, true);
});

test("zero trace/span identifiers are rejected, repeated context remains separate log events", async () => {
  const bodies = [];
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "http://localhost:4318/custom",
    },
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response("{}");
    },
  });
  assert.equal(exporter.record({ name: "ttft", traceId: "0".repeat(32) }), false);
  assert.equal(exporter.record({ name: "ttft", spanId: "0".repeat(16) }), false);
  const base = { name: "ttft", traceId: "a".repeat(32), spanId: "b".repeat(16) };
  exporter.record({ ...base, phase: "start" });
  exporter.record({ ...base, phase: "end", metrics: { durationMs: 42 } });
  await exporter.shutdown();
  assert.equal(bodies[0].resourceLogs[0].scopeLogs[0].logRecords.length, 2);
  assert.ok(!JSON.stringify(bodies).includes("resourceSpans"));
});

test("record does not evaluate accessors or propagate malformed input errors", async () => {
  let reads = 0;
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    },
  });
  assert.equal(
    exporter.record({
      name: "runtime",
      get metrics() {
        reads++;
        throw new Error("PRIVATE");
      },
    }),
    false,
  );
  assert.equal(reads, 0);
  await exporter.shutdown();
});

test("collector rejection reports only a fixed status/count, once per outage", async (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://PRIVATE.invalid/path",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=PRIVATE",
    },
    fetch: async () => new Response("PRIVATE response", { status: 503 }),
  });
  exporter.record({ name: "startup" });
  await exporter.flush();
  exporter.record({ name: "startup" });
  await exporter.shutdown();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].statusCode, 503);
  assert.ok(!JSON.stringify(warnings).includes("PRIVATE"));
});

test("disabled export allocates no timer", async (t) => {
  t.mock.method(globalThis, "setTimeout", () => {
    throw new Error("Unexpected diagnostic timer");
  });
  const exporter = createDiagnosticsExporter({
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" },
  });
  exporter.record({ name: "startup" });
  await exporter.flush();
  await exporter.shutdown();
});

test("an empty flush followed immediately by record and flush cannot strand a batch", async () => {
  let calls = 0;
  const exporter = createDiagnosticsExporter({
    env: {
      ZCODE_DIAGNOSTICS_EXPORT_ENABLED: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    },
    fetch: async () => {
      calls++;
      return new Response("{}");
    },
  });
  const empty = exporter.flush();
  exporter.record({ name: "startup" });
  await exporter.flush();
  await empty;
  assert.equal(calls, 1);
  await exporter.shutdown();
});
