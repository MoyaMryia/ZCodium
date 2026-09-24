import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
import { bundleRemoteAssets } from "../bundle-remote-assets.mjs";
import { createRemoteAssetFixture } from "./remoteAssetsFixture.mjs";

const { ZCODE_VERSION: version } = await tsImport("@zcode/shared", import.meta.url);
const { deployServer } = await tsImport(
  "../../packages/server/src/remote/deploy.ts",
  import.meta.url,
);
const { quotePosixShellArg } = await tsImport(
  "../../packages/server/src/remote/posixShell.ts",
  import.meta.url,
);
const environment = { platform: "linux", arch: "x64" };

function contentForPath(id, path) {
  if (id === "node-runtime" && path === "node")
    return `#!/bin/sh\nexec ${quotePosixShellArg(process.execPath)} "$@"\n`;
  if (id === "server-bundle")
    return `// skill-sync mcp-sync plugin-sync __zcode_rpc_nested_uint8array_v1 exportMarketplaceSourceArchive importMarketplaceSourceArchive\nrequire("fs").writeSync(1, ${JSON.stringify(version)});`;
  return "fixture";
}

async function fixture(t) {
  const data = await createRemoteAssetFixture(t, contentForPath, version);
  await bundleRemoteAssets(data.options);
  const remote = join(data.root, "remote");
  await mkdir(remote);
  const uploads = [];
  const commands = [];
  const path = (value) => (value.startsWith("~/") ? join(remote, value.slice(2)) : value);
  const backend = {
    async exists(value) {
      return (await stat(path(value)).catch(() => null))?.isFile() ?? false;
    },
    async readFile(value) {
      return readFile(path(value), "utf8");
    },
    async upload(from, to) {
      uploads.push(to);
      await copyFile(from, path(to));
    },
    async exec(command) {
      commands.push(command);
      assert.doesNotMatch(command, /\b(curl|wget)\b/);
      // 将远端路径映射到隔离目录，不修改 HOME，也不触碰真实用户安装。
      const mapped = command.replaceAll('"$HOME"', quotePosixShellArg(remote));
      const child = spawn("/bin/sh", ["-c", mapped], { cwd: remote });
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        onClose(listener) {
          child.once("close", listener);
          return { dispose: () => child.off("close", listener) };
        },
      };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("component network forbidden");
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const deploy = (options = {}) =>
    deployServer(backend, environment, {
      bundledRemoteAssetsDir: data.options.outputDirectory,
      deployLockMode: "caller-serialized",
      ...options,
    });
  return {
    ...data,
    remote,
    uploads,
    commands,
    backend,
    deploy,
    installed: (value) => join(remote, ".zcodium/server", value),
  };
}

test(
  "offline first deployment, reconnect and missing component repair use only the bundle",
  { skip: process.platform === "win32" },
  async (t) => {
    const { deploy, uploads, installed } = await fixture(t);
    assert.equal(await deploy(), true);
    assert.equal(uploads.length, 8);
    const firstUploads = uploads.length;
    assert.equal(await deploy(), false);
    assert.equal(uploads.length, firstUploads);
    for (const relativePath of [
      "node",
      "build/Release/pty.node",
      "tools/ripgrep/rg",
      "agents/glm/packages/bundled-skills/skills/dynamic-workflows/SKILL.md",
    ]) {
      const before = uploads.length;
      await rm(installed(relativePath));
      await deploy();
      assert.ok(uploads.length > before, relativePath);
      assert.ok((await stat(installed(relativePath))).isFile());
      const repaired = uploads.length;
      await deploy();
      assert.equal(uploads.length, repaired);
    }
  },
);

test(
  "a damaged bundle cannot update a working remote installation or fall back to downloads",
  { skip: process.platform === "win32" },
  async (t) => {
    const { deploy, options, manifest, installed, uploads } = await fixture(t);
    await deploy();
    const before = await readFile(installed("zcode-server.cjs"));
    const count = uploads.length;
    await writeFile(join(options.outputDirectory, manifest.components[0].artifactPath), "corrupt");
    await assert.rejects(deploy({ force: true }), /SHA256 mismatch/);
    assert.equal(uploads.length, count);
    assert.deepEqual(await readFile(installed("zcode-server.cjs")), before);
  },
);

test(
  "same-version component changes and an older remote server are refreshed",
  { skip: process.platform === "win32" },
  async (t) => {
    const { deploy, uploads, installed } = await fixture(t);
    await deploy();
    const initialUploads = uploads.length;
    const changed = (id, path) => contentForPath(id, path) + (id === "glm" ? "\nupdated" : "");
    const agentUpdate = await createRemoteAssetFixture(t, changed, version);
    await bundleRemoteAssets(agentUpdate.options);
    const agentOptions = { bundledRemoteAssetsDir: agentUpdate.options.outputDirectory };
    assert.equal(await deploy(agentOptions), false);
    assert.equal(uploads.length, initialUploads + 2);
    assert.equal(await readFile(installed("agents/glm/zcode.cjs"), "utf8"), "fixture\nupdated");
    await deploy(agentOptions);
    assert.equal(uploads.length, initialUploads + 2);

    const nodeUpdate = await createRemoteAssetFixture(
      t,
      (id, path) =>
        changed(id, path) + (id === "node-runtime" && path === "node" ? "# rebuilt\n" : ""),
      version,
    );
    await bundleRemoteAssets(nodeUpdate.options);
    const nodeOptions = { bundledRemoteAssetsDir: nodeUpdate.options.outputDirectory };
    await deploy(nodeOptions);
    assert.equal(uploads.length, initialUploads + 3);
    await deploy(nodeOptions);
    assert.equal(uploads.length, initialUploads + 3);

    await writeFile(installed("zcode-server.cjs"), 'require("fs").writeSync(1, "0.0.0-old");');
    assert.equal(await deploy(nodeOptions), true);
    assert.equal(uploads.length, initialUploads + 6);
    await deploy(nodeOptions);
    assert.equal(uploads.length, initialUploads + 6);
  },
);

test(
  "unsupported remote targets are rejected before commands or upload",
  { skip: process.platform === "win32" },
  async (t) => {
    const { backend, options, commands, uploads } = await fixture(t);
    await assert.rejects(
      deployServer(
        backend,
        { platform: "linux", arch: "arm64" },
        { bundledRemoteAssetsDir: options.outputDirectory },
      ),
      /Unsupported/,
    );
    assert.equal(commands.length, 0);
    assert.equal(uploads.length, 0);
  },
);
