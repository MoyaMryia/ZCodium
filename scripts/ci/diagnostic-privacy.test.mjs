import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { safeLogArgs } = await tsImport(
  "../../packages/shared/src/diagnosticPrivacy.ts",
  import.meta.url,
);
const { DiagnosticRecordSchema } = await tsImport(
  "../../packages/shared/src/diagnostics.ts",
  import.meta.url,
);
test("privacy gate drops sensitive text at all nesting levels but keeps technical measurements", () => {
  const secret = "private-user-token-/home/person/project-https://private.invalid/prompt";
  const error = new Error(secret);
  error.code = "EACCES";
  error.stack = `Error: ${secret}\n at /home/person/project/packages/ui/src/logger.ts:12:3\n at /home/person/private.ts:9:3`;
  const cycle = {};
  cycle.self = cycle;
  const result = safeLogArgs([
    secret,
    { prompt: secret, sessionId: secret, durationMs: 13, count: 2, nested: { body: secret } },
    error,
    cycle,
  ]);
  const encoded = JSON.stringify(result);
  assert.ok(!encoded.includes(secret));
  assert.ok(!encoded.includes("/home/person"));
  assert.ok(encoded.includes("EACCES"));
  assert.ok(encoded.includes('"durationMs":13'));
  assert.ok(encoded.includes("packages/ui/src/logger.ts:12:3"));
});
test("strict records reject extra attributes, arbitrary classes and nonfinite metrics", () => {
  assert.equal(
    DiagnosticRecordSchema.safeParse({ name: "ttft", prompt: "private" }).success,
    false,
  );
  assert.equal(
    DiagnosticRecordSchema.safeParse({ name: "ttft", metrics: { secret: 1 } }).success,
    false,
  );
  assert.equal(
    DiagnosticRecordSchema.safeParse({ name: "ttft", metrics: { count: Infinity } }).success,
    false,
  );
  const record = DiagnosticRecordSchema.parse({
    name: "ttft",
    component: "host",
    metrics: { durationMs: 42 },
  });
  assert.deepEqual(safeLogArgs(["diagnostic", record]), ["diagnostic", record]);
});

test("multiple logger hops retain safe error locations and technical context", () => {
  const err = new TypeError("PRIVATE input");
  err.stack = "TypeError: PRIVATE input\n at /home/private/packages/ui/src/logger.ts:19:2";
  const once = safeLogArgs([err, { stage: "request", durationMs: 5 }]);
  assert.deepEqual(safeLogArgs(once), once);
});

test("remote stderr framing rejects raw secrets and retains validated split records", async () => {
  const { createRemoteDiagnosticConsumer } = await tsImport(
    "../../packages/server/src/remote/diagnosticStream.ts",
    import.meta.url,
  );
  const output = [];
  const consume = createRemoteDiagnosticConsumer((args) => output.push(args));
  const line =
    JSON.stringify({
      kind: "zcodium.diagnostic",
      args: ["diagnostic", { name: "ttft", metrics: { durationMs: 18 } }, "PRIVATE token"],
    }) + "\n";
  consume(Buffer.from(line.slice(0, 20)));
  assert.equal(output.length, 0);
  consume(Buffer.from(line.slice(20)));
  consume(Buffer.from("PRIVATE raw error /home/person\n"));
  consume(Buffer.from("x".repeat(70000)));
  consume(Buffer.from("\n" + line));
  assert.ok(!JSON.stringify(output).includes("PRIVATE"));
  assert.equal(output.length, 3);
  assert.equal(output[0][1].metrics.durationMs, 18);
});

test("optional resource metrics survive while unknown attributes remain rejected", async () => {
  const { parseDiagnosticRecord } = await tsImport(
    "../../packages/shared/src/diagnostics.ts",
    import.meta.url,
  );
  assert.deepEqual(
    parseDiagnosticRecord({
      name: "process.resource",
      metrics: { rssBytes: 1024, heapUsedBytes: undefined },
    }).metrics,
    { rssBytes: 1024 },
  );
  assert.equal(
    parseDiagnosticRecord({ name: "process.resource", metrics: { privateKey: undefined } }),
    undefined,
  );
});

test("Windows and Linux packaged stack positions survive repeated privacy filtering", async () => {
  const { safeDiagnosticFrames } = await tsImport(
    "../../packages/shared/src/diagnosticPrivacy.ts",
    import.meta.url,
  );
  const frames = safeDiagnosticFrames(
    "Error: PRIVATE\n at C:\\Users\\PRIVATE\\app\\main\\index.js:12:3\n at file:///opt/PRIVATE/assets/index-abcdefgh.js:24:5",
  );
  assert.deepEqual(frames, ["main/index.js:12:3", "renderer-bundle.js:24:5"]);
  assert.deepEqual(safeLogArgs(safeLogArgs([{ frames }]))[0], { frames });
});
