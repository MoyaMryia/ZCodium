import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { tsImport } from "tsx/esm/api";
const { ConversationArchiveImports } = await tsImport(
  "../../packages/services/src/conversation-share/conversationArchiveImports.ts",
  import.meta.url,
);
const { ConversationArchiveImporter } = await tsImport(
  "../../packages/services/src/conversation-share/conversationArchiveImporter.ts",
  import.meta.url,
);
const { buildConversationSharePublicProjection } = await tsImport(
  "../../packages/services/src/conversation-share/conversationSharePublicProjection.ts",
  import.meta.url,
);
const { encodeConversationArchive } = await tsImport(
  "../../packages/services/src/conversation-share/conversationArchive.ts",
  import.meta.url,
);
const { ConversationShareService, conversationShareConnectionScopeFactory } = await tsImport(
  "../../packages/services/src/conversation-share/conversationShareService.ts",
  import.meta.url,
);
const { importConversationArchive } = await tsImport(
  "../../packages/ui/src/lib/importConversationArchive.ts",
  import.meta.url,
);
const hash = (data) => createHash("sha256").update(data).digest("hex");

test("import transport enforces scope, length, sequential chunks, retry identity and capacity", async () => {
  let now = 0;
  const transfers = new ConversationArchiveImports(() => now);
  const owner = Symbol(),
    other = Symbol();
  assert.throws(() => transfers.begin(owner, 0));
  assert.throws(() => transfers.begin(owner, 73 * 1024 * 1024));
  const id = transfers.begin(owner, 3);
  assert.throws(() => transfers.append(other, id, 0, "YWJj"));
  assert.throws(() => transfers.append(owner, id, 1, "YWJj"));
  assert.throws(() => transfers.append(owner, id, 0, "Y WJj"));
  transfers.append(owner, id, 0, "YWJj");
  transfers.append(owner, id, 0, "YWJj");
  assert.throws(() => transfers.append(owner, id, 0, "YWJk"));
  const another = transfers.begin(owner, 4);
  assert.throws(() => transfers.begin(owner, 3));
  await assert.rejects(transfers.consume(owner, another, async () => "incomplete"));
  transfers.release(owner, another);
  const content = await transfers.consume(owner, id, async (bytes) => {
    transfers.release(owner, id);
    const occupied = transfers.begin(owner, 1);
    assert.throws(() => transfers.begin(owner, 1));
    transfers.release(owner, occupied);
    return bytes.toString();
  });
  assert.equal(content, "abc");
  assert.throws(() => transfers.append(owner, id, 0, "YWJj"));
  const expired = transfers.begin(owner, 1);
  now = 600001;
  assert.throws(() => transfers.append(owner, expired, 0, "YQ=="));
});

function archive() {
  const bytes = Buffer.from("offline attachment\0");
  const base = {
    turnId: "share-turn-1",
    productTurnId: "share-product-turn-1",
    createdAt: 1,
    createdAtSeq: 1,
  };
  const projection = buildConversationSharePublicProjection({
    rows: [
      {
        ...base,
        rowId: 1,
        kind: "turnHeader",
        state: "completedSuccess",
        origin: "userInput",
        startedAt: 1,
      },
      { ...base, rowId: 2, kind: "userInput", origin: "realUser", text: "Imported question" },
      {
        ...base,
        rowId: 3,
        kind: "artifact",
        artifactVersionId: "original",
        logicalArtifactKey: "key",
        displayName: "CON.txt",
        artifactType: "text",
        mimeType: "text/plain",
        sizeBytes: bytes.length,
        sha256: hash(bytes),
        ref: "zcode-artifact://session/result",
        state: "current",
      },
    ],
    selectedProductTurnIds: [base.productTurnId],
  });
  const descriptors = projection.artifacts.map((item) => item.descriptor);
  return {
    content: {
      format: "zcodium-conversation",
      version: 1,
      title: "Offline note",
      selectedProductTurnIds: projection.selectedProductTurnIds,
      rows: projection.rows,
      artifacts: descriptors,
    },
    artifacts: new Map(descriptors.map((item) => [item.artifact_id, bytes])),
  };
}
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "zcodium-import-"));
  const sessions = new Map();
  const creates = [];
  let fail = null;
  const service = {
    listSessions: async (params) => {
      assert.ok(params.sessionIds?.length === 1, "must query exact session, not first page");
      return params.sessionIds.flatMap((id) => (sessions.has(id) ? [sessions.get(id)] : []));
    },
    createSession: async (params) => {
      creates.push(params);
      if (fail === "before") throw new Error("commit failed");
      const session = { sessionId: params.sessionId, title: params.importedHistory.title };
      sessions.set(session.sessionId, session);
      if (fail === "after") throw new Error("reply lost");
      return { session };
    },
  };
  const importer = () =>
    new ConversationArchiveImporter({ sessionService: service, conversationWorkspaceRoot: root });
  try {
    await run({
      root,
      sessions,
      creates,
      importer,
      service,
      setFailure: (value) => {
        fail = value;
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("offline import creates local provenance and reopens the same session after restart", async () => {
  await fixture(async ({ root, creates, importer }) => {
    const decoded = archive();
    const sha = hash("fixture archive");
    const input = { archiveId: "handle", clientRequestId: "request" };
    const first = await importer().import(decoded, sha, input, "op");
    const second = await importer().import(decoded, sha, input, "op2");
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.reused, true);
    assert.equal(creates.length, 1);
    assert.deepEqual(creates[0].importedHistory.provenance.source, {
      kind: "localArchive",
      archiveSha256: sha,
    });
    assert.equal(creates[0].importedHistory.provenance.shareUrl, undefined);
    const installed = creates[0].importedHistory.provenance.installedArtifacts[0];
    assert.deepEqual(
      await readFile(join(root, installed.workspaceRelativePath)),
      [...decoded.artifacts.values()][0],
    );
    assert.doesNotMatch(installed.workspaceRelativePath, /\/CON\.txt$/);
  });
});

test("failed or uncertain commit preserves attachments and retry uses the same session id", async () => {
  for (const mode of ["before", "after"])
    await fixture(async ({ root, creates, importer, setFailure }) => {
      const sha = hash("retry archive");
      const decoded = archive();
      const input = { archiveId: "handle", clientRequestId: "request" };
      setFailure(mode);
      await assert.rejects(importer().import(decoded, sha, input, "first"));
      assert.equal((await readdir(join(root, ".zcodium-share"))).length, 1);
      const original = creates[0];
      assert.deepEqual(
        await readFile(
          join(
            root,
            original.importedHistory.provenance.installedArtifacts[0].workspaceRelativePath,
          ),
        ),
        [...decoded.artifacts.values()][0],
      );
      setFailure(null);
      const next = await importer().import(decoded, sha, input, "retry");
      assert.equal(next.sessionId, original.sessionId);
      assert.equal(creates.length, mode === "after" ? 1 : 2);
    });
});

test("real codec, scoped service and UI transfer import offline; corrupt files never touch destination", async () => {
  await fixture(async ({ root, service, creates }) => {
    const original = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("Network forbidden");
    };
    try {
      const decoded = archive();
      const encoded = await encodeConversationArchive({
        ...decoded.content,
        artifacts: decoded.content.artifacts.map((descriptor) => ({
          descriptor,
          bytes: decoded.artifacts.get(descriptor.artifact_id),
        })),
      });
      const host = new ConversationShareService({
        zcodeSessionService: service,
        zcodeAgentService: {},
        artifactSource: {},
        conversationWorkspaceRoot: root,
      });
      const one = host[conversationShareConnectionScopeFactory]({});
      const other = host[conversationShareConnectionScopeFactory]({});
      assert.equal(await one.canImport(), true);
      const id = await one.beginArchiveImport(3);
      await assert.rejects(other.appendArchiveImport(id, 0, "YWJj"));
      await one.releaseArchiveImport(id);
      await assert.rejects(
        importConversationArchive(
          one,
          Uint8Array.from([0, 1, 2]).buffer,
          { clientRequestId: "bad" },
          "bad",
        ),
        (error) => error.kind === "invalid_contract",
      );
      assert.deepEqual(await readdir(root), []);
      const bytes = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.length);
      const result = await importConversationArchive(
        one,
        bytes,
        { clientRequestId: "good" },
        "good",
      );
      assert.equal(creates.length, 1);
      assert.equal(creates[0].importedHistory.provenance.source.archiveSha256, hash(encoded));
      const restored = await one.getImportedConversation({
        workspacePath: root,
        contextId: result.contextId,
      });
      assert.equal(restored.title, decoded.content.title);
      assert.equal(restored.rows.length, decoded.content.rows.length);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test("independent Host owners serialize imports and deletion allows a fresh session", async () => {
  await fixture(async ({ root, sessions, creates, importer, service }) => {
    let release, entered;
    const enteredPromise = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const create = service.createSession;
    service.createSession = async (input) => {
      entered();
      await gate;
      return create(input);
    };
    const first = importer().import(
      archive(),
      hash("concurrent"),
      { archiveId: "1", clientRequestId: "1" },
      "1",
    );
    await enteredPromise;
    const second = importer().import(
      archive(),
      hash("concurrent"),
      { archiveId: "2", clientRequestId: "2" },
      "2",
    );
    release();
    const results = await Promise.all([first, second]);
    assert.equal(results[0].sessionId, results[1].sessionId);
    assert.equal(creates.length, 1);
    sessions.clear();
    const third = await importer().import(
      archive(),
      hash("concurrent"),
      { archiveId: "3", clientRequestId: "3" },
      "3",
    );
    assert.notEqual(third.sessionId, results[0].sessionId);
    assert.equal(creates.length, 2);
    assert.equal((await readdir(join(root, ".zcodium-share"))).length, 1);
  });
});

test("remote destination falls back to local owner without leaking identity; distinct destinations stay independent", async () => {
  await fixture(async ({ root, creates, importer }) => {
    const input = {
      archiveId: "id",
      clientRequestId: "id",
      targetWorkspacePath: "/unavailable/remote",
      targetWorkspaceIdentity: "ssh:fixture",
      targetWorkspaceKind: "remote",
    };
    const first = await importer().import(archive(), hash("destination"), input, "op");
    assert.equal(first.workspacePath, root);
    assert.equal(first.workspaceIdentity, undefined);
    assert.equal(first.fallbackReason, "remote_workspace");
    assert.equal(creates[0].workspaceIdentity, undefined);
    const second = await importer().import(
      archive(),
      hash("destination"),
      {
        ...input,
        targetWorkspacePath: join(root, "another"),
        targetWorkspaceIdentity: undefined,
        targetWorkspaceKind: "local",
      },
      "op2",
    );
    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(creates.length, 2);
  });
});

test("untrusted receipts and changed recovery files cannot authorize deletion or a second commit", async () => {
  await fixture(async ({ root, creates, importer, setFailure }) => {
    const sha = hash("untrusted");
    const directory = join(root, ".zcodium-share", "archive-" + sha);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "keep.txt"), "user content");
    await assert.rejects(
      importer().import(archive(), sha, { archiveId: "x", clientRequestId: "x" }, "x"),
    );
    assert.equal(await readFile(join(directory, "keep.txt"), "utf8"), "user content");
    assert.equal(creates.length, 0);
    const recoverySha = hash("changed");
    setFailure("before");
    await assert.rejects(
      importer().import(archive(), recoverySha, { archiveId: "y", clientRequestId: "y" }, "y"),
    );
    const installed = join(
      root,
      creates[0].importedHistory.provenance.installedArtifacts[0].workspaceRelativePath,
    );
    await writeFile(installed, Buffer.alloc(100_000, 42));
    setFailure(null);
    await assert.rejects(
      importer().import(archive(), recoverySha, { archiveId: "z", clientRequestId: "z" }, "z"),
      (error) => error.kind === "invalid_contract",
    );
    assert.equal(creates.length, 1);
    assert.equal((await readFile(installed)).length, 100_000);
  });
});
