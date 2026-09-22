import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const cli = new URL("../src/cli.ts", import.meta.url).pathname;

test("offline derive converts only an explicitly supplied existing trajectory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-offline-trajectory-"));
  try {
    const input = join(directory, "input.jsonl");
    await writeFile(
      input,
      [
        { kind: "request", requestIndex: 1, bodyWithoutMessages: { model: "fixture-model" } },
        {
          kind: "message",
          requestIndex: 1,
          messageIndex: 0,
          message: { role: "user", content: "fixture prompt" },
        },
      ]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n",
    );
    const output = join(directory, "output");
    await execute(process.execPath, [
      "--import",
      "tsx",
      cli,
      "derive",
      "--input",
      input,
      "--out",
      output,
    ]);
    const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
    assert.equal(manifest.trajectories.length, 1);
    assert.equal(manifest.trajectories[0].messageCount, 1);
    await assert.rejects(
      execute(process.execPath, ["--import", "tsx", cli, "derive", "--out", output]),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removed recording entrypoints cannot start a provider proxy", async () => {
  for (const command of ["record", "record-prompt"]) {
    await assert.rejects(
      execute(process.execPath, ["--import", "tsx", cli, command]),
      (error: unknown) => {
        assert.equal((error as { code: number }).code, 1);
        return true;
      },
    );
  }
});

test("existing Model-IO files still convert offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-offline-modelio-"));
  try {
    const input = join(directory, "input.jsonl");
    await writeFile(
      input,
      JSON.stringify({
        querySource: "main_turn",
        request: {
          body: {
            model: "fixture-model",
            messages: [{ role: "user", content: "fixture prompt" }],
          },
        },
        response: { text: "fixture response" },
      }) + "\n",
    );
    const output = join(directory, "output");
    await execute(process.execPath, [
      "--import",
      "tsx",
      cli,
      "model-io",
      "--input",
      input,
      "--out",
      output,
    ]);
    const artifact = await readFile(join(output, "anthropic_trajectory.json"), "utf8");
    assert.ok(artifact.includes("fixture prompt"));
    assert.ok(artifact.includes("fixture response"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
