import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  artifactNames,
  collectArtifacts,
  publishDraft,
  validateTag,
  verifyReleaseAssets,
} from "./desktop-release.mjs";

const version = "3.14.0";
const allNames = [
  "ZCodium-3.14.0-linux-x86_64.AppImage",
  "ZCodium-3.14.0-linux-amd64.deb",
  "ZCodium-3.14.0-linux-x86_64.rpm",
  "ZCodium-3.14.0-linux-x64.pkg.tar.zst",
  "ZCodium-3.14.0-win-x64.exe",
];

async function fixture(t, names = allNames) {
  const directory = await mkdtemp(join(tmpdir(), "zcodium-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of names) await writeFile(join(directory, name), `artifact: ${name}`);
  return directory;
}

test("release tag must exactly match a valid package version", () => {
  validateTag("v3.14.0", version);
  validateTag("v3.15.0-rc.1", "3.15.0-rc.1");
  for (const tag of ["3.14.0", "v3.14.1", "v3.14.0\n", "v3.14.0;echo x"]) {
    assert.throws(() => validateTag(tag, version));
  }
  for (const invalid of ["../3.14.0", "03.14.0", "3.14", "3.14.0-01", "3.14.0+build"]) {
    assert.throws(() => validateTag(`v${invalid}`, invalid));
  }
  assert.throws(() => artifactNames("mac", version));
});

test("collect only installers, excluding unpacked app and builder metadata", async (t) => {
  const source = await fixture(t);
  const output = await fixture(t, []);
  await writeFile(join(source, "latest-linux.yml"), "metadata");
  await collectArtifacts(source, output, "linux", version);
  assert.equal(await readFile(join(output, allNames[0]), "utf8"), `artifact: ${allNames[0]}`);
  await assert.rejects(readFile(join(output, "latest-linux.yml")), { code: "ENOENT" });
  await assert.rejects(readFile(join(output, allNames[4])), { code: "ENOENT" });
});

test("missing, empty, wrong-version and extra assets block release", async (t) => {
  const missing = await fixture(t, allNames.slice(0, -1));
  await assert.rejects(verifyReleaseAssets(missing, version));
  const empty = await fixture(t);
  await writeFile(join(empty, allNames[0]), "");
  await assert.rejects(verifyReleaseAssets(empty, version), /empty/);
  const extra = await fixture(t);
  await writeFile(join(extra, "ZCodium-3.13.0-win-x64.exe"), "old");
  await assert.rejects(verifyReleaseAssets(extra, version), /Unexpected/);
  const wrongVersion = await fixture(
    t,
    allNames.map((name) => name.replace(version, "3.13.0")),
  );
  await assert.rejects(verifyReleaseAssets(wrongVersion, version));
});

test("checksums cover exactly the five validated installers and can be regenerated", async (t) => {
  const directory = await fixture(t);
  const paths = await verifyReleaseAssets(directory, version);
  const expected = allNames
    .toSorted()
    .map((name) => {
      const hash = createHash("sha256").update(`artifact: ${name}`).digest("hex");
      return `${hash}  ${name}\n`;
    })
    .join("");
  assert.equal(await readFile(join(directory, "SHA256SUMS"), "utf8"), expected);
  assert.equal(paths.length, 6);
  await verifyReleaseAssets(directory, version);
});

function githubMock(releases = []) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    return { stdout: args[1] === "list" ? JSON.stringify(releases) : "" };
  };
  return { run, calls };
}

test("create a draft then upload assets; never publish it", async () => {
  const { run, calls } = githubMock();
  await publishDraft({ tag: "v3.14.0", repo: "owner/repo", files: ["/tmp/artifact"], run });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].includes("--draft"));
  assert.ok(calls[1].includes("--verify-tag"));
  assert.equal(calls[2][2], "upload");
  assert.ok(calls[2].includes("--clobber"));
});

test("rerun updates only a draft and refuses an already public release", async () => {
  const draft = githubMock([{ tagName: "v3.14.0", isDraft: true }]);
  await publishDraft({ tag: "v3.14.0", repo: "owner/repo", files: ["a"], run: draft.run });
  assert.equal(draft.calls.length, 2);
  assert.equal(draft.calls[1][2], "upload");
  const published = githubMock([{ tagName: "v3.14.0", isDraft: false }]);
  await assert.rejects(
    publishDraft({ tag: "v3.14.0", repo: "owner/repo", files: ["a"], run: published.run }),
    /published/,
  );
  assert.equal(published.calls.length, 1);
});

test("prerelease tags create prerelease drafts", async () => {
  const { run, calls } = githubMock();
  await publishDraft({ tag: "v3.14.0-ci.1", repo: "owner/repo", files: ["a"], run });
  assert.ok(calls[1].includes("--draft"));
  assert.ok(calls[1].includes("--prerelease"));
});

test("lookup failures stop before creating or modifying a release", async () => {
  let calls = 0;
  await assert.rejects(
    publishDraft({
      tag: "v3.14.0",
      repo: "owner/repo",
      files: ["a"],
      run: async () => {
        calls++;
        throw new Error("network unavailable");
      },
    }),
    /network unavailable/,
  );
  assert.equal(calls, 1);
});
