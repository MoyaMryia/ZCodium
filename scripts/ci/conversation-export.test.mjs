import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { ConversationArchiveExports } = await tsImport(
  "../../packages/services/src/conversation-share/conversationArchiveExports.ts",
  import.meta.url,
);
const { saveConversationExport } = await tsImport(
  "../../packages/ui/src/lib/saveConversationExport.ts",
  import.meta.url,
);

test("exports are bounded, connection scoped, expire and clean up failed producers", async () => {
  let now = 0;
  const exports = new ConversationArchiveExports(() => now);
  const owner = Symbol(),
    other = Symbol();
  const bytes = Buffer.alloc(600_000, 42);
  const first = await exports.create(owner, "CON:/report. ", async () => bytes);
  assert.match(first.suggestedName, /^conversation-.+\.zcodium$/);
  assert.equal(first.byteLength, bytes.length);
  assert.throws(() => exports.read(other, first.archiveId, 0));
  assert.throws(() => exports.read(owner, first.archiveId, -1));
  assert.throws(() => exports.read(owner, first.archiveId, 0.1));
  const chunk = exports.read(owner, first.archiveId, 0);
  assert.equal(Buffer.from(chunk, "base64").length, 512 * 1024);
  exports.release(other, first.archiveId);
  assert.equal(exports.read(owner, first.archiveId, 0), chunk);
  const second = await exports.create(owner, "second", async () => Buffer.from("ok"));
  await assert.rejects(exports.create(owner, "third", async () => Buffer.from("no")));
  exports.release(owner, second.archiveId);
  await assert.rejects(
    exports.create(owner, "failed", async () => {
      throw new Error("test");
    }),
  );
  now = 600_001;
  assert.throws(() => exports.read(owner, first.archiveId, 0));
  const next = await exports.create(owner, "valid", async () => Buffer.from("retry"));
  exports.release(owner, next.archiveId);
  exports.release(owner, next.archiveId);
});

test("a producing export already occupies capacity", async () => {
  const exports = new ConversationArchiveExports();
  const owner = Symbol();
  let complete;
  const pending = exports.create(
    owner,
    "pending",
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const ready = await exports.create(owner, "ready", async () => Buffer.from("ready"));
  await assert.rejects(exports.create(owner, "overload", async () => Buffer.from("no")));
  complete(Buffer.from("done"));
  const finished = await pending;
  exports.release(owner, ready.archiveId);
  exports.release(owner, finished.archiveId);
});

test("saving collects chunks before platform save, cancellation and failure always release", async () => {
  for (const outcome of ["success", "cancel", "failure", "broken-chunk"]) {
    const exports = new ConversationArchiveExports();
    const owner = Symbol();
    const expected = Buffer.alloc(600_000, 77);
    const descriptor = await exports.create(owner, "title", async () => expected);
    let released = 0,
      saves = 0;
    const service = {
      readExportChunk: async (id, offset) =>
        outcome === "broken-chunk" ? "" : exports.read(owner, id, offset),
      releaseExport: async (id) => {
        released++;
        exports.release(owner, id);
      },
    };
    const platform = {
      saveFile: async ({ data, suggestedName }) => {
        saves++;
        assert.deepEqual(Buffer.from(data), expected);
        assert.equal(suggestedName, descriptor.suggestedName);
        if (outcome === "failure") throw new Error("private host path");
        return outcome === "cancel" ? { success: false, canceled: true } : { success: true };
      },
    };
    if (outcome === "failure" || outcome === "broken-chunk")
      await assert.rejects(saveConversationExport(service, platform, descriptor));
    else
      assert.equal(
        (await saveConversationExport(service, platform, descriptor)).canceled,
        outcome === "cancel" ? true : undefined,
      );
    assert.equal(released, 1);
    assert.equal(saves, outcome === "broken-chunk" ? 0 : 1);
    assert.throws(() => exports.read(owner, descriptor.archiveId, 0));
  }
});

test("real service exports selected turns and files offline with scoped handles", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ConversationShareService, conversationShareConnectionScopeFactory } = await tsImport(
    "../../packages/services/src/conversation-share/conversationShareService.ts",
    import.meta.url,
  );
  const { createLocalConversationShareArtifactSource } = await tsImport(
    "../../packages/services/src/conversation-share/conversationShareArtifactSource.ts",
    import.meta.url,
  );
  const { decodeConversationArchive } = await tsImport(
    "../../packages/services/src/conversation-share/conversationArchive.ts",
    import.meta.url,
  );
  const directory = await mkdtemp(join(tmpdir(), "zcodium-export-"));
  const originalFetch = globalThis.fetch;
  const forbidden = () => {
    throw new Error("Network or unscoped access forbidden");
  };
  globalThis.fetch = forbidden;
  let reads = 0;
  const base = {
    turnId: "private-turn",
    productTurnId: "private-product",
    createdAt: 1,
    createdAtSeq: 1,
  };
  const rows = [
    {
      ...base,
      rowId: 1,
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 1,
    },
    {
      ...base,
      rowId: 2,
      kind: "userInput",
      origin: "realUser",
      text: "Keep selected text",
      clientId: "PRIVATE identity",
    },
    { ...base, rowId: 3, kind: "assistantText", state: "complete", text: "[Report](report.pdf)" },
    {
      ...base,
      rowId: 4,
      turnId: "excluded-turn",
      productTurnId: "excluded-product",
      kind: "turnHeader",
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 1,
    },
    {
      ...base,
      rowId: 5,
      turnId: "excluded-turn",
      productTurnId: "excluded-product",
      kind: "userInput",
      origin: "realUser",
      text: "EXCLUDED conversation",
    },
  ];
  try {
    const file = Buffer.from("selected binary attachment\0\xff");
    await writeFile(join(directory, "report.pdf"), file);
    const host = new ConversationShareService({
      zcodeAgentService: { conversationRowsRangeV4: forbidden },
      artifactSource: createLocalConversationShareArtifactSource(),
      conversationWorkspaceRoot: directory,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    const agent = {
      conversationRowsRangeV4: async (input) => {
        assert.equal(input.workspaceIdentity, "TEST identity");
        reads++;
        return { rows, hasMore: false, atRevision: 1, atLogEpoch: "epoch" };
      },
    };
    const service = host[conversationShareConnectionScopeFactory](agent);
    const other = host[conversationShareConnectionScopeFactory](agent);
    const input = {
      workspacePath: directory,
      workspaceIdentity: "TEST identity",
      sessionId: "session",
      title: "Report",
      clientRequestId: "request",
      selection: { kind: "productTurns", productTurnIds: ["private-product"] },
    };
    const preflight = await service.preflight(input);
    assert.deepEqual(preflight.blockingIssues, []);
    const archive = await service.publish(input, "operation");
    await assert.rejects(other.readExportChunk(archive.archiveId, 0));
    await assert.rejects(host.readExportChunk(archive.archiveId, 0));
    const parts = [];
    for (let offset = 0; offset < archive.byteLength; ) {
      const part = Buffer.from(await service.readExportChunk(archive.archiveId, offset), "base64");
      parts.push(part);
      offset += part.length;
    }
    const decoded = await decodeConversationArchive(Buffer.concat(parts));
    assert.doesNotMatch(
      JSON.stringify(decoded.content),
      /PRIVATE|EXCLUDED|private-turn|TEST identity/,
    );
    assert.equal(decoded.artifacts.size, 1);
    assert.deepEqual([...decoded.artifacts.values()][0], file);
    assert.ok(reads >= 2);
    await service.releaseExport(archive.archiveId);
    await assert.rejects(service.readExportChunk(archive.archiveId, 0));
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("native data save atomically replaces files and leaves no staging directory", async () => {
  const { mkdtemp, writeFile, readFile, mkdir, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeSavedFile } = await tsImport(
    "../../packages/desktop/src/main/writeSavedFile.ts",
    import.meta.url,
  );
  const directory = await mkdtemp(join(tmpdir(), "zcodium-save-"));
  try {
    const target = join(directory, "report.zcodium");
    await writeFile(target, "previous");
    const bytes = Buffer.alloc(51 * 1024 * 1024, 37);
    await writeSavedFile(target, bytes);
    assert.deepEqual(await readFile(target), bytes);
    assert.deepEqual(await readdir(directory), ["report.zcodium"]);
    const blocked = join(directory, "blocked");
    await mkdir(blocked);
    await writeFile(join(blocked, "keep"), "old data");
    await assert.rejects(writeSavedFile(blocked, Buffer.from("new")));
    assert.equal(await readFile(join(blocked, "keep"), "utf8"), "old data");
    assert.deepEqual((await readdir(directory)).sort(), ["blocked", "report.zcodium"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
