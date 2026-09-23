/**
 * surface-daemon 构建脚本。
 *
 * 产出四个目标平台的二进制，并生成一份 sha256 manifest——与现有
 * `resources/tools/cua-helper/runtime-manifest.json` 的形状保持一致，
 * 这样宿主可以用同一套校验代码加载 DeskPilot 与旧 CUA。
 *
 * 交叉编译需要对应 target 的 toolchain；缺工具时按平台跳过并在 manifest 里标注，
 * 不允许把上一个平台的二进制冒充成这个平台的。
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = join(nativeRoot, "dist");
const manifestPath = join(nativeRoot, "runtime-manifest.json");

/** target triple → 产物文件名。顺序即 manifest 顺序。 */
const TARGETS = [
  {
    triple: "x86_64-pc-windows-msvc",
    platform: "win32",
    arch: "x64",
    binary: "surface-daemon.exe",
  },
  {
    triple: "aarch64-pc-windows-msvc",
    platform: "win32",
    arch: "arm64",
    binary: "surface-daemon.exe",
  },
  { triple: "x86_64-apple-darwin", platform: "darwin", arch: "x64", binary: "surface-daemon" },
  { triple: "aarch64-apple-darwin", platform: "darwin", arch: "arm64", binary: "surface-daemon" },
  { triple: "x86_64-unknown-linux-gnu", platform: "linux", arch: "x64", binary: "surface-daemon" },
  {
    triple: "aarch64-unknown-linux-gnu",
    platform: "linux",
    arch: "arm64",
    binary: "surface-daemon",
  },
];

const SCHEMA_VERSION = 1;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  return spawnSync(command, args, { cwd: nativeRoot, encoding: "utf8" });
}

function main() {
  mkdirSync(distRoot, { recursive: true });
  const entries = [];
  const skipped = [];

  for (const target of TARGETS) {
    const built = run("cargo", ["build", "--release", "--target", target.triple]);
    if (built.status !== 0) {
      // 工具链缺失就明确跳过；绝不用别的平台的产物顶上。
      skipped.push({ triple: target.triple, reason: "cargo build failed or toolchain missing" });
      console.error(`[surface-daemon] skip ${target.triple}: ${built.stderr?.trim() ?? "unknown"}`);
      continue;
    }
    const artifact = join(distRoot, target.triple, "release", target.binary);
    if (!existsSync(artifact)) {
      skipped.push({ triple: target.triple, reason: "artifact missing after a successful build" });
      continue;
    }
    const bytes = readFileSync(artifact);
    entries.push({
      platform: target.platform,
      arch: target.arch,
      triple: target.triple,
      binary: target.binary,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    packageName: "@zcode/desk-pilot",
    entry: "surface-daemon",
    generatedAt: new Date().toISOString(),
    targets: entries,
    skipped,
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `[surface-daemon] built ${entries.length}/${TARGETS.length} targets; manifest at ${manifestPath}`,
  );
  if (entries.length === 0) {
    console.error("[surface-daemon] no target built; manifest records every skip reason");
    process.exitCode = 1;
  }
}

function clean() {
  rmSync(distRoot, { recursive: true, force: true });
  rmSync(manifestPath, { force: true });
}

if (process.argv.includes("--clean")) {
  clean();
} else {
  main();
}

// 供 `node scripts/build-desk-pilot.mjs` 复用：列出当前 manifest 里的目标。
export function listBundledTargets() {
  if (!existsSync(manifestPath)) return [];
  return JSON.parse(readFileSync(manifestPath, "utf8")).targets ?? [];
}

export function listDistFiles() {
  if (!existsSync(distRoot)) return [];
  return readdirSync(distRoot);
}
