import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDebugApp } from "../server/index.js";

test("offline trace list and detail remain readable and never mutate the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-offline-viewer-"));
  const logs = join(directory, "logs");
  await mkdir(logs);
  const file = join(logs, "fixture.jsonl");
  const content =
    JSON.stringify({
      timestamp: "2026-01-01T00:00:00.000Z",
      traceId: "fixture-trace",
      sessionId: "fixture-session",
      level: "info",
      message: "Offline fixture",
      event: "session.start",
    }) + "\n";
  await writeFile(file, content);
  const query = new URLSearchParams({ logDir: logs, dbPath: join(directory, "missing.sqlite") });
  try {
    const app = createDebugApp();
    assert.equal((await app.request("/api/health")).status, 200);
    const list = await app.request(`/api/traces?${query}`);
    assert.equal(list.status, 200);
    assert.equal((await list.json()).traces[0].traceId, "fixture-trace");
    const detail = await app.request(`/api/traces/fixture-trace?${query}`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).timeline[0].label, "session.start");
    assert.equal(await readFile(file, "utf8"), content);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removed capture routes stay 404 even with SPA fallback and legacy capture environment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-offline-ui-"));
  await writeFile(join(directory, "index.html"), "<main>Offline viewer</main>");
  const previous = process.env.ZCODE_DEBUG_NETWORK_CAPTURE;
  process.env.ZCODE_DEBUG_NETWORK_CAPTURE = "1";
  try {
    const app = createDebugApp({ staticRoot: directory });
    for (const path of ["status", "requests", "ca.pem", "events"]) {
      const response = await app.request(`/api/network/${path}`);
      assert.equal(response.status, 404);
    }
    assert.equal((await app.request("/offline-view")).status, 200);
  } finally {
    if (previous === undefined) delete process.env.ZCODE_DEBUG_NETWORK_CAPTURE;
    else process.env.ZCODE_DEBUG_NETWORK_CAPTURE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
