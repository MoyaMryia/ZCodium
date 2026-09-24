import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireVerifiedArchive, remoteNodeDistribution } from "../remote-node-runtime.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-node-dist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("only the pinned Linux x64 distribution is an eligible remote build target", () => {
  const dist = remoteNodeDistribution("linux-x64");
  assert.equal(dist.version, "v22.16.0");
  assert.match(dist.sha256, /^[a-f0-9]{64}$/);
  for (const platform of ["win32-x64", "linux-arm64", "../linux-x64", "darwin-x64"]) {
    assert.throws(() => remoteNodeDistribution(platform), /Unsupported remote platform/);
  }
});

test("verified cached archives work without network; corrupted caches are rejected", async (t) => {
  const directory = await fixture(t);
  const archivePath = join(directory, "node.tar.xz");
  const expected = Buffer.from("pinned distribution");
  const options = {
    archivePath,
    url: "https://fixture.invalid/node.tar.xz",
    sha256: sha256(expected),
    fetchImpl: () => {
      throw new Error("network forbidden");
    },
  };
  await writeFile(archivePath, expected);
  assert.equal(await acquireVerifiedArchive(options), archivePath);
  await writeFile(archivePath, "corrupt");
  await assert.rejects(acquireVerifiedArchive(options), /SHA256 mismatch/);
});

test("download verification happens before cache commit and never accepts a truncated response", async (t) => {
  const directory = await fixture(t);
  const archivePath = join(directory, "node.tar.xz");
  const expected = Buffer.from("fixed archive bytes");
  const options = {
    archivePath,
    url: "https://fixture.invalid/node.tar.xz",
    sha256: sha256(expected),
  };
  await assert.rejects(
    acquireVerifiedArchive({ ...options, fetchImpl: async () => new Response("wrong") }),
    /SHA256 mismatch/,
  );
  await assert.rejects(readFile(archivePath), { code: "ENOENT" });
  await acquireVerifiedArchive({ ...options, fetchImpl: async () => new Response(expected) });
  assert.deepEqual(await readFile(archivePath), expected);
});
