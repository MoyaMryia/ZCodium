import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { tsImport } from "tsx/esm/api";
import { resolveBuildAliases } from "../../apps/zcode-cli/packages/cli/scripts/build.mjs";

const { sharedContextImportStateSchema, restoreSharedContextImportState } = await tsImport(
  "../../packages/shared/src/zcode-protocol-v4/shared-context-import.ts",
  import.meta.url,
);
const { zcodeSessionImportHistorySchema } = await tsImport(
  "../../packages/shared/src/zcode-protocol/index.ts",
  import.meta.url,
);
const { resolveAttachableShareContext } = await tsImport(
  "../../packages/ui/src/lib/conversationShareContext.ts",
  import.meta.url,
);
const { applyConversationDeltas } = await tsImport(
  "../../packages/shared/src/zcode-protocol-v4/apply.ts",
  import.meta.url,
);
const local = (status = "pending") => ({
  contextId: "context-fixture",
  title: "Imported file",
  source: { kind: "localArchive", archiveSha256: "a".repeat(64) },
  status,
});
const legacy = {
  contextId: "legacy-fixture",
  title: "Old import",
  shareUrl: "https://example.invalid/cn/share/fixture",
  status: "pending",
};

test("local shared-context state is strict and old persisted imports remain readable", () => {
  for (const state of [local(), legacy, { title: "Title-only import" }])
    assert.deepEqual(sharedContextImportStateSchema.parse(state), state);
  for (const bad of [
    { ...local(), shareUrl: legacy.shareUrl },
    { ...local(), source: { kind: "localArchive", archiveSha256: "bad" } },
    { ...local(), source: { ...local().source, path: "/PRIVATE/file" } },
    { ...local(), source: { kind: "remote", url: legacy.shareUrl } },
  ])
    assert.equal(sharedContextImportStateSchema.safeParse(bad).success, false);
});

test("session import contract carries a local origin without allowing mixed cloud origins", () => {
  const provenance = {
    shareId: "archive-fixture",
    contextId: local().contextId,
    source: local().source,
    status: "pending",
    projectionSha256: "b".repeat(64),
    artifactSetSha256: "c".repeat(64),
    formatterVersion: 1,
    markdownSha256: "d".repeat(64),
    installedArtifacts: [],
  };
  const input = {
    source: "sharedContext",
    title: "Imported file",
    markdown: "Chosen content",
    provenance,
  };
  assert.deepEqual(zcodeSessionImportHistorySchema.parse(input), input);
  assert.equal(
    zcodeSessionImportHistorySchema.safeParse({
      ...input,
      provenance: { ...provenance, shareUrl: legacy.shareUrl },
    }).success,
    false,
  );
  const { contextId: _contextId, ...missingContext } = provenance;
  assert.equal(
    zcodeSessionImportHistorySchema.safeParse({ ...input, provenance: missingContext }).success,
    false,
  );
});

test("restoration uses the same source rules for cold reads and reserved/discarded updates", () => {
  for (const status of ["pending", "reserved", "attached", "discarded"]) {
    const restored = restoreSharedContextImportState("Imported file", {
      ...local(status),
      privatePath: "/PRIVATE/workspace",
    });
    assert.deepEqual(restored, local(status));
    assert.deepEqual(
      restoreSharedContextImportState("Imported file", local(), status),
      local(status),
    );
    assert.equal(
      resolveAttachableShareContext(restored)?.contextId,
      status === "discarded" ? undefined : local().contextId,
    );
  }
  assert.deepEqual(restoreSharedContextImportState(legacy.title, legacy), legacy);
  assert.deepEqual(
    restoreSharedContextImportState(local().title, { ...local(), shareUrl: legacy.shareUrl }),
    { title: local().title },
  );
  assert.deepEqual(
    restoreSharedContextImportState(local().title, {
      ...local(),
      source: { kind: "localArchive", archiveSha256: "bad" },
    }),
    { title: local().title },
  );
  assert.equal(restoreSharedContextImportState(" ", local()), undefined);
  assert.equal(resolveAttachableShareContext({ title: "Old record" }), null);
});

test("real CLI cold recovery and projection retain local origin without adding rows or sequence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-share-context-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = join(directory, "runtime.cjs");
  await build({
    stdin: {
      contents:
        'export { loadPersistedConversationMaterialization } from "./apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/cold-event-merge.ts"; export { ProductProjection } from "./apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/product-projection.ts";',
      resolveDir: process.cwd(),
    },
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    alias: resolveBuildAliases(),
    logLevel: "silent",
  });
  const { loadPersistedConversationMaterialization, ProductProjection } = createRequire(
    import.meta.url,
  )(outfile);
  const contextMessage = {
    info: {
      id: "fixture-message",
      role: "user",
      source: "shared_context",
      semantics: { origin: "import", kind: "shared_context" },
    },
    parts: [],
  };
  for (const status of ["pending", "reserved", "attached", "discarded"]) {
    const result = await loadPersistedConversationMaterialization({
      sessionId: "fixture",
      memoryEvents: [],
      store: {
        getSession: async () => ({ title: local().title }),
        messages: async () => [contextMessage],
        readTarget: async () => null,
        sessionEntries: async () => [{ type: "v4/shared_context_import", data: local(status) }],
      },
    });
    assert.deepEqual(result.sharedContextImport, local(status));
    const projection = new ProductProjection("fixture", "fixture-epoch");
    const before = projection.getSnapshot();
    projection.seedSharedContextImport(result.sharedContextImport);
    const after = projection.getSnapshot();
    assert.deepEqual(after.sharedContextImport, local(status));
    assert.equal(after.revision, before.revision);
    assert.deepEqual(after.rows, before.rows);
    const changed = {
      ...local(status),
      source: { kind: "localArchive", archiveSha256: "b".repeat(64) },
    };
    projection.seedSharedContextImport(changed);
    assert.deepEqual(projection.getSnapshot().sharedContextImport, changed);
    const beforeTurn = structuredClone(projection.getSnapshot());
    const deltas = projection.applyEvent({
      id: "turn-started-fixture",
      sequenceNumber: 1,
      type: "turn_started",
      sessionId: "fixture",
      turnId: "turn-fixture",
      timestamp: new Date(1),
      payload: {
        input: "Continue",
        inputId: "command-fixture",
        turnNumber: 1,
        intent: {
          text: "Continue",
          sharedContextRefs: [{ kind: "shared_context_import", context_id: changed.contextId }],
        },
      },
    });
    const expected = { ...changed, status: status === "discarded" ? "discarded" : "attached" };
    assert.deepEqual(projection.getSnapshot().sharedContextImport, expected);
    assert.deepEqual(applyConversationDeltas(beforeTurn, deltas).sharedContextImport, expected);
  }
  const absent = await loadPersistedConversationMaterialization({
    sessionId: "fixture",
    memoryEvents: [],
    store: {
      getSession: async () => ({ title: local().title }),
      messages: async () => [],
      readTarget: async () => null,
      sessionEntries: async () => [{ type: "v4/shared_context_import", data: local() }],
    },
  });
  assert.equal(absent.sharedContextImport, undefined);
});
