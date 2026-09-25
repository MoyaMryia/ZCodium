import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { tsImport } from "tsx/esm/api";
const { LocalUploadAssetInstaller } = await tsImport(
  "../../packages/server/src/remote/remoteAssetInstaller.ts",
  import.meta.url,
);

async function fixture(t, { corrupt = false, failPromotion = false, controller } = {}) {
  const root = await mkdtemp(join(tmpdir(), "zcodium-upload-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "binary"), "new verified bytes");
  await mkdir(join(source, "packages"));
  await writeFile(join(source, "packages", "required"), "new plugin");
  const commands = [];
  const backend = {
    async upload(from, to) {
      await copyFile(from, to);
      if (corrupt) await writeFile(to, "corrupted transport");
      controller?.abort();
    },
    async exec(command) {
      commands.push(command);
      assert.doesNotMatch(command, /\b(curl|wget)\b/);
      if (failPromotion)
        command = command
          .split("\n")
          .map((line) =>
            line.startsWith("command mv -f ") && line.includes(".extract-") ? "false" : line,
          )
          .join("\n");
      const child = spawn("/bin/sh", ["-c", command], { cwd: root });
      return {
        stdin: child.stdin,
        stdout: child.stdout,
        stderr: child.stderr,
        onClose: (listener) => {
          child.once("close", listener);
          return { dispose: () => child.off("close", listener) };
        },
      };
    },
  };
  const installer = new LocalUploadAssetInstaller(
    backend,
    { releaseDir: source, signal: controller?.signal },
    { log() {}, logWarn() {} },
  );
  return { root, installer, commands };
}

test(
  "verified uploads replace files and directories without any download tool",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root, installer } = await fixture(t);
    const path = join(root, "installed");
    await installer.installFile({
      componentId: "node-runtime",
      sourceRelativePath: "binary",
      remotePath: path,
      executable: true,
    });
    assert.equal(await readFile(path, "utf8"), "new verified bytes");
    await installer.installDirectory({
      componentId: "glm",
      sourceRelativePath: "packages",
      remoteDir: join(root, "plugins"),
      requiredRelativePaths: ["required"],
    });
    assert.equal(await readFile(join(root, "plugins/required"), "utf8"), "new plugin");
  },
);

test(
  "directory promotion failure restores the previous installation",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root, installer } = await fixture(t, { failPromotion: true });
    const plugins = join(root, "plugins");
    await mkdir(plugins);
    await writeFile(join(plugins, "old"), "old working plugin");
    await assert.rejects(
      installer.installDirectory({
        componentId: "glm",
        sourceRelativePath: "packages",
        remoteDir: plugins,
      }),
    );
    assert.equal(await readFile(join(plugins, "old"), "utf8"), "old working plugin");
  },
);

test(
  "corrupted upload fails before replacing the installed file or directory",
  { skip: process.platform === "win32" },
  async (t) => {
    const { root, installer } = await fixture(t, { corrupt: true });
    const path = join(root, "installed");
    await writeFile(path, "old working file");
    await assert.rejects(
      installer.installFile({
        componentId: "node-runtime",
        sourceRelativePath: "binary",
        remotePath: path,
      }),
    );
    assert.equal(await readFile(path, "utf8"), "old working file");
    const plugins = join(root, "plugins");
    await mkdir(plugins);
    await writeFile(join(plugins, "old"), "old working plugin");
    await assert.rejects(
      installer.installDirectory({
        componentId: "glm",
        sourceRelativePath: "packages",
        remoteDir: plugins,
      }),
    );
    assert.equal(await readFile(join(plugins, "old"), "utf8"), "old working plugin");
  },
);

test(
  "abort after upload never replaces the live file or reconnects for cleanup",
  { skip: process.platform === "win32" },
  async (t) => {
    const controller = new AbortController();
    const { root, installer, commands } = await fixture(t, { controller });
    const path = join(root, "installed");
    await writeFile(path, "old");
    await assert.rejects(
      installer.installFile({
        componentId: "node-runtime",
        sourceRelativePath: "binary",
        remotePath: path,
      }),
      { name: "AbortError" },
    );
    assert.equal(await readFile(path, "utf8"), "old");
    assert.ok(!commands.some((command) => command.includes("command mv")));
  },
);
