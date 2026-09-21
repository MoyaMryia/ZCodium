import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { parseMultipart, startSnapshotServer } from "../src/server.js";
import { scanRepoSnapshot, workspaceKeyHash, workspaceKeyOf } from "../src/scan.js";
import { computeManifestHash, readManifest, readState, statePathFor, writeManifest } from "../src/state.js";
import { writeTarGz } from "../src/tar.js";
import { decryptArchive, encryptArchive, openLocalVault } from "../src/vault.js";
import { uploadSnapshot } from "../src/upload.js";

/** 造一个带 .git 的假工作区。 */
async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "parody-e2e-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".git", "objects", "pack"), { recursive: true });
  await mkdir(join(root, "node_modules", "junk"), { recursive: true });
  await mkdir(join(root, "dist"), { recursive: true });

  await writeFile(join(root, "src", "main.ts"), "export const main = 1;\n");
  await writeFile(join(root, "README.md"), "# demo\n");
  await writeFile(join(root, ".git", "config"), "[remote \"origin\"]\n\turl = https://user:token@gitlab.internal/demo.git\n");
  await writeFile(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  // 超过 1 MiB 的 .git 文件：验证 .git 跳过体积上限
  await writeFile(join(root, ".git", "objects", "pack", "pack-big.pack"), "x".repeat(1024 * 1024 + 10));
  // 二进制源码文件：应当被排除
  await writeFile(join(root, "src", "blob.bin"), Buffer.from([0x00, 0x01, 0x02]));
  // 被排除的目录
  await writeFile(join(root, "node_modules", "junk", "index.js"), "junk");
  await writeFile(join(root, "dist", "bundle.js"), "built");
  return root;
}

test("端到端：扫描 → 打包 → 加密 → 传 127.0.0.1 → 本地解密还原", async (t) => {
  const workspace = await makeWorkspace();
  const stateDir = await mkdtemp(join(tmpdir(), "parody-state-"));
  t.after(() => {
    void rm(workspace, { recursive: true, force: true });
    void rm(stateDir, { recursive: true, force: true });
  });

  const vault = await openLocalVault(join(stateDir, "keys"));
  const receivedDir = join(stateDir, "received");
  const server = await startSnapshotServer({
    port: 0,
    storageDir: receivedDir,
    log: () => {},
  });
  t.after(() => server.close());

  // 1. 扫描
  const { manifest, absolutePaths } = await scanRepoSnapshot(workspace);
  const manifestHash = computeManifestHash(manifest);
  const paths = manifest.files.map((file) => file.path);

  assert.ok(paths.includes("src/main.ts"));
  assert.ok(paths.includes(".git/config"));
  assert.ok(paths.includes(".git/objects/pack/pack-big.pack"), ".git 必须跳过 1 MiB 上限");
  assert.ok(!paths.includes("src/blob.bin"), "普通二进制应排除");
  assert.ok(!paths.some((path) => path.startsWith("node_modules/")));
  assert.ok(!paths.some((path) => path.startsWith("dist/")));

  // 2. 打包
  const archivePath = join(stateDir, "tmp.tar.gz");
  const archived = await writeTarGz(
    manifest.files.map((file) => ({
      path: file.path,
      absolutePath: absolutePaths.get(file.path)!,
      sizeBytes: file.sizeBytes,
    })),
    archivePath,
  );
  assert.equal(archived.fileCount, manifest.files.length);

  // 3. 加密（本地密钥）
  const encryptedPath = join(stateDir, "snap.tar.gz.enc");
  const envelopePath = join(stateDir, "envelope.json");
  const encrypted = await encryptArchive({
    plaintextArchivePath: archivePath,
    encryptedArtifactPath: encryptedPath,
    envelopePath,
    vault,
    workspaceKeyHash: workspaceKeyHash(workspaceKeyOf(workspace)),
    kind: "baseline",
    manifestHash,
  });

  // 4. 上传到 127.0.0.1
  const result = await uploadSnapshot({
    baseUrl: `http://127.0.0.1:${server.port}`,
    workspaceKeyHash: workspaceKeyHash(workspaceKeyOf(workspace)),
    groupId: manifestHash.slice(0, 12),
    encryptedArtifactPath: encryptedPath,
    envelope: encrypted.envelope,
    manifest,
    artifactBytes: encrypted.encryptedSizeBytes,
  });
  assert.equal(result.ok, true, result.responseBody);

  // 5. 接收端报告的内容 == 清单内容
  assert.equal(server.received.length, 1);
  const received = server.received[0]!;
  assert.equal(received.manifestFileCount, manifest.stats.includedFileCount);
  assert.equal(received.manifestBytes, manifest.stats.includedBytes);
  assert.ok(received.gitInternalFileCount >= 3, "至少 .git/config、HEAD、pack 三个");
  assert.ok(received.gitInternalBytes > 1024 * 1024, "大 pack 应当在内");

  // 6. 本地解密——原版做不到的一步
  const groupDir = join(receivedDir, manifestHash.slice(0, 12));
  const restored = join(groupDir, "restored.tar.gz");
  await decryptArchive({
    envelopePath: join(groupDir, "envelope.json"),
    encryptedArtifactPath: join(groupDir, "snapshot.tar.gz.enc"),
    outputPath: restored,
    vault,
  });
  assert.equal(
    await readFile(restored, "utf8").then((buffer) => buffer.length),
    await readFile(archivePath, "utf8").then((buffer) => buffer.length),
  );

  // 7. 解开后逐条对账
  const extractDir = join(groupDir, "x");
  await mkdir(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", restored, "-C", extractDir]);
  for (const file of manifest.files) {
    const original = await readFile(join(workspace, file.path));
    const extracted = await readFile(join(extractDir, file.path));
    assert.equal(extracted.length, original.length, `长度不一致：${file.path}`);
  }
  assert.equal(
    (await readFile(join(extractDir, ".git", "config"), "utf8")).includes("gitlab.internal"),
    true,
    ".git/config 里的内网 GitLab 地址应能还原出来——这就是原版传走的东西",
  );
});

test("multipart 解析：字段与文件都能取回", () => {
  const boundary = "----probe";
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nparody/abc/x.enc\r\n`, "utf8"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.enc"\r\nContent-Type: application/octet-stream\r\n\r\n`, "utf8"),
    Buffer.from([0x00, 0x01, 0xff, 0x0d, 0x0a, 0x2d, 0x2d]),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
  const parts = parseMultipart(body, `multipart/form-data; boundary=${boundary}`);
  const byName = new Map(parts.map((part) => [part.name, part]));
  assert.equal(byName.get("key")?.body.toString("utf8"), "parody/abc/x.enc");
  assert.deepEqual([...(byName.get("file")?.body ?? [])], [0x00, 0x01, 0xff, 0x0d, 0x0a, 0x2d, 0x2d]);
  assert.equal(byName.get("file")?.filename, "x.enc");
});

test("manifest 与 state 落盘后可读回", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "parody-state-io-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { manifest } = await scanRepoSnapshot(dir);
  const hash = computeManifestHash(manifest);
  const workspacesRoot = join(dir, "workspaces");
  const keyHash = workspaceKeyHash(manifest.workspaceKey);
  const manifestPath = join(workspacesRoot, keyHash, "manifests", `${hash}.json`);
  await writeManifest(manifestPath, manifest);
  const readBack = await readManifest(manifestPath);
  assert.deepEqual(readBack.files, manifest.files);

  const statePath = statePathFor(workspacesRoot, keyHash);
  await rm(statePath, { force: true });
  // 修复依据：RepoSnapshotManifest 只携带 workspaceKey，没有 workspacePath 字段。
  // 原先写 manifest.workspacePath 运行时是 undefined，readState 会把它原样存进 state，
  // 而此处断言只查 failureCount / lastAcceptedManifestHash，所以错误被掩盖、tsc 才报 TS2339。
  // 扫描时的入参 dir 才是真正的 workspace 路径。
  const initial = await readState(statePath, dir, manifest.workspaceKey);
  assert.equal(initial.failureCount, 0);
  assert.equal(initial.lastAcceptedManifestHash, undefined);
});
