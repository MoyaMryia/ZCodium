import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { createRemotePtyBuildPlugin } from "../remote-pty-build.mjs";
import { verifyBundledRemoteAssets } from "../bundle-remote-assets.mjs";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const { version: agentVersion } = JSON.parse(
  await readFile(join(root, "apps/zcode-cli/package.json"), "utf8"),
);
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Remote runtime smoke tests require Linux x64");
}
const directory = resolve(process.argv[2] || join(root, "packages/desktop/bundled-remote-assets"));
const manifest = await verifyBundledRemoteAssets(directory, version);
const staging = await mkdtemp(join(tmpdir(), "zcodium-remote-smoke-"));

try {
  for (const component of manifest.components) {
    const output = join(staging, component.mount);
    await mkdir(output, { recursive: true });
    await run("tar", ["-xzf", join(directory, component.artifactPath), "-C", output]);
  }
  const node = join(staging, "node/linux-x64/node");
  const options = {
    timeout: 20_000,
    cwd: staging,
    env: { ...process.env, ZCODE_DATA_BASE_DIR: join(staging, "user-data") },
  };
  assert.ok((await stat(node)).mode & 0o111, "archive must retain Node executable mode");
  assert.equal((await run(node, ["--version"], options)).stdout.trim(), "v22.16.0");
  assert.equal(
    (
      await run(node, [join(staging, "server/zcode-server.cjs"), "--version"], options)
    ).stdout.trim(),
    version,
  );
  assert.equal(
    (
      await run(node, [join(staging, "glm/linux-x64/zcode.cjs"), "--version"], options)
    ).stdout.trim(),
    agentVersion,
  );

  const fixture = join(staging, "needle.txt");
  await writeFile(fixture, "zcodium_offline_needle\n");
  for (const [tool, executable] of [
    ["ripgrep", "rg"],
    ["ugrep", "ugrep"],
  ]) {
    const result = await run(
      join(staging, `tools/linux-x64/${tool}/${executable}`),
      ["zcodium_offline_needle", fixture],
      options,
    );
    assert.ok(result.stdout.includes("zcodium_offline_needle"));
  }
  const found = await run(
    join(staging, "tools/linux-x64/bfs/bfs"),
    [staging, "-name", "needle.txt"],
    options,
  );
  assert.ok(found.stdout.includes("needle.txt"));

  const ptyScript = String.raw`
    import assert from "node:assert/strict";
    import { spawn } from "node-pty";
    let output = "";
    let exitCode;
    const done = () => {
      if (exitCode === undefined || !output.includes("PTY_OK:offline") || !output.includes("40 100")) return;
      assert.equal(exitCode, 7);
      process.stdout.write("PTY input/resize/exit OK\n", () => process.exit(0));
    };
    const terminal = spawn("/bin/sh", ["-c", 'read value; stty size; printf "PTY_OK:%s\\n" "$value"; exit 7'], { cols: 80, rows: 24, cwd: process.cwd(), env: { PATH: "/usr/bin:/bin", TERM: "xterm" } });
    terminal.onData((data) => { output += data; done(); });
    terminal.onExit(({ exitCode: code }) => { exitCode = code; done(); });
    terminal.resize(100, 40);
    terminal.write("offline\n");
  `;
  const ptySmoke = join(staging, "pty-smoke.cjs");
  const ptyBuild = await build({
    stdin: { contents: ptyScript, resolveDir: root },
    outfile: ptySmoke,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    metafile: true,
    plugins: [createRemotePtyBuildPlugin()],
  });
  assert.ok(
    Object.keys(ptyBuild.metafile.inputs).some((path) =>
      path.includes("@lydell/node-pty-linux-x64/lib/unixTerminal.js"),
    ),
  );
  await mkdir(join(staging, "build/Release"), { recursive: true });
  await copyFile(
    join(staging, "node-pty/linux-x64/pty.node"),
    join(staging, "build/Release/pty.node"),
  );
  const terminal = await run(node, [ptySmoke], options);
  assert.match(terminal.stdout, /PTY input\/resize\/exit OK/);
  console.log(
    "Remote bundle verified: Node, Server, Agent, PTY input/resize/exit, bfs, ripgrep, ugrep",
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
