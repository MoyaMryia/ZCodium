import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { parseZCodeProcessDiagnostic } from "@zcode/shared/process-diagnostic";
import { installStderrConsoleBoundary } from "../src/protocol-console.js";
import { installCliProcessErrorBoundary } from "../src/process-errors.js";
import { installNodeReplProcessGuards } from "../../node-repl-host/src/process-lifecycle.js";

const secret = "PRIVATE_prompt_token_/home/private/request_body";
const privateError = () => {
  const error = new Error(secret);
  error.stack = `Error: ${secret}\n at privateFn (/home/private/apps/zcode-cli/packages/cli/src/main.ts:42:9)\n at token (/home/private/custom.ts:1:2)`;
  return error;
};

test("console boundary sanitizes all arguments before formatting and preserves restore", () => {
  const sink = new PassThrough();
  let output = "";
  sink.on("data", (chunk) => {
    output += String(chunk);
  });
  const original = console;
  const restore = installStderrConsoleBoundary(sink);
  try {
    console.info(secret, { prompt: secret }, privateError());
    console.dir({ password: secret });
    console.table([{ request: secret }]);
    console.trace(secret);
    console.assert(false, secret);
    console.time(secret);
    console.timeEnd(secret);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("/home/private"), false);
    assert.equal(output.includes("custom.ts"), false);
    assert.ok(output.includes("apps/zcode-cli/packages/cli/src/main.ts:42:9"));
  } finally {
    restore();
    restore();
  }
  assert.equal(console, original);
});

test("CLI fatal diagnostic remains single and structured without raw rejection/error", () => {
  const target = new EventEmitter();
  let output = "";
  const reasons: unknown[] = [];
  const dispose = installCliProcessErrorBoundary({
    target,
    stderr: {
      write: (text) => {
        output += text;
      },
    },
    onFatal: (reason) => reasons.push(reason),
  });
  const error = privateError();
  target.emit("uncaughtExceptionMonitor", error, "uncaughtException");
  target.emit("uncaughtException", error);
  target.emit("unhandledRejection", secret);
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0], error);
  const diagnostic = parseZCodeProcessDiagnostic(output.split("\n")[0]!);
  assert.equal(diagnostic?.kind, "uncaughtException");
  assert.deepEqual(diagnostic?.frames, ["apps/zcode-cli/packages/cli/src/main.ts:42:9"]);
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("/home/private"), false);
  dispose();
  assert.equal(target.listenerCount("unhandledRejection"), 0);
});

test("REPL diagnostics hide private data and closed output still shuts down once", () => {
  const target = new EventEmitter();
  let output = "";
  let closed = 0;
  installNodeReplProcessGuards({
    process: target as unknown as NodeJS.Process,
    writeStderr: (text) => {
      output += text;
    },
    onOutputClosed: () => {
      closed += 1;
    },
  });
  target.emit("unhandledRejection", privateError());
  target.emit("unhandledRejection", { prompt: secret });
  assert.equal(output.includes(secret), false);
  assert.equal(output.includes("/home/private"), false);
  assert.ok(output.includes("apps/zcode-cli/packages/cli/src/main.ts:42:9"));
  const before = output;
  const pipeError = Object.assign(new Error(secret), { code: "EPIPE" });
  target.emit("uncaughtException", pipeError);
  target.emit("unhandledRejection", pipeError);
  assert.equal(output, before);
  assert.equal(closed, 1);
});

test("subagent preserves executable output without private metadata sidecars", async () => {
  const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createSessionId, createTraceId } = await import("@zcode/contracts");
  const { createExploreSubagentPort } = await import("../../core/src/subagent/runner.js");
  const root = await mkdtemp(join(tmpdir(), "zcodium-subagent-privacy-"));
  const sessionId = createSessionId("privacy-session");
  const events: unknown[] = [];
  try {
    const port = createExploreSubagentPort({
      outputRootDir: root,
      createAgentId: () => "privacy-agent",
      emitParentEvent: async (event) => {
        events.push(event);
      },
      runExploreAgent: async (request) => {
        assert.equal(request.prompt, secret);
        await request.onSessionReady?.();
        return { response: "business result", traceId: request.traceContext.traceId, events: [] };
      },
    });
    const result = await port.run({
      sessionId,
      agentType: "Explore",
      description: secret,
      prompt: secret,
      parentToolCallId: "call-privacy",
      workingDirectory: root,
      workspaceRoot: root,
      trace: { traceId: createTraceId(), sessionId },
    });
    assert.equal(result.status, "completed");
    const directory = join(root, sessionId, "privacy-agent");
    assert.deepEqual((await readdir(directory)).sort(), ["output.txt", "task.output"]);
    assert.equal(await readFile(join(directory, "output.txt"), "utf8"), "business result");
    assert.ok(events.length >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TUI stderr barrier does not retain or replay third-party private text", async () => {
  const { interceptTuiStderr } = await import("../src/tui-stderr.js");
  const sink = new PassThrough();
  let output = "";
  sink.on("data", (chunk) => {
    output += String(chunk);
  });
  const barrier = interceptTuiStderr(sink as unknown as NodeJS.WriteStream);
  await new Promise<void>((resolve) => sink.write(secret, resolve));
  barrier.passthrough.write("normal CLI result");
  barrier.restore();
  assert.equal(output, "normal CLI result");
  assert.equal("bufferedOutput" in barrier, false);
});
