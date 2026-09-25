import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, open, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
// Draft release 的首行固定为本仓库的立意句，其后才是构建说明。
const RELEASE_MESSAGE_HEADING =
  "He who seeks to stand, shall raise others; he who aspires to flourish, shall see others flourish. " +
  "己欲立而立人，己欲达而达人。";
const RELEASE_MESSAGE_BODY =
  "Linux x64 and Windows x64/arm64. Unsigned builds; review and test both platforms before publishing. Verify downloads with SHA256SUMS.";
// electron-builder 按发行格式改写 ${arch}，必须匹配实际产物而非统一猜测 x64。
// Windows 同时发 x64 与 arm64：electron-builder 可在 x64 runner 上交叉构建 arm64，
// 原生库 @trycua/cua-driver-win32-arm64-msvc 已随 SDK 的 optionalDependencies 分发。
const extensions = {
  linux: [
    { extension: "AppImage", arch: "x86_64" },
    { extension: "deb", arch: "amd64" },
    { extension: "rpm", arch: "x86_64" },
    { extension: "pkg.tar.zst", arch: "x64" },
  ],
  win: [
    { extension: "exe", arch: "x64" },
    { extension: "exe", arch: "arm64" },
  ],
};
const number = "(?:0|[1-9][0-9]*)";
const identifier = `(?:${number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const versionPattern = new RegExp(
  `^${number}\\.${number}\\.${number}(?:-${identifier}(?:\\.${identifier})*)?$`,
);

function validateVersion(version) {
  if (typeof version !== "string" || version !== version.trim() || !versionPattern.test(version)) {
    throw new Error(`Unsupported release version: ${version}`);
  }
}

export function validateTag(tag, version) {
  validateVersion(version);
  if (tag !== `v${version}`) throw new Error(`Expected tag v${version}, received ${tag}`);
}

export function artifactNames(platform, version) {
  validateVersion(version);
  if (!Object.hasOwn(extensions, platform)) throw new Error(`Unsupported platform: ${platform}`);
  return extensions[platform].map(
    ({ extension, arch }) => `ZCodium-${version}-${platform}-${arch}.${extension}`,
  );
}

async function assertInstaller(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size === 0) throw new Error(`Invalid or empty installer: ${file}`);
}

export async function collectArtifacts(source, destination, platform, version) {
  const names = artifactNames(platform, version);
  for (const name of names) await assertInstaller(join(source, name));
  await mkdir(destination, { recursive: true });
  if ((await readdir(destination)).length)
    throw new Error(`Artifact directory must be empty: ${destination}`);
  for (const name of names) await copyFile(join(source, name), join(destination, name));
}

export async function verifyReleaseAssets(directory, version) {
  const names = Object.keys(extensions)
    .flatMap((platform) => artifactNames(platform, version))
    .sort();
  const allowed = new Set([...names, "SHA256SUMS"]);
  for (const name of await readdir(directory)) {
    if (!allowed.has(name)) throw new Error(`Unexpected release asset: ${name}`);
  }
  const files = names.map((name) => join(directory, name));
  for (const file of files) await assertInstaller(file);
  const sums = [];
  for (const [index, file] of files.entries()) {
    const hash = createHash("sha256");
    const handle = await open(file, "r");
    try {
      for await (const chunk of handle.createReadStream()) hash.update(chunk);
    } finally {
      await handle.close();
    }
    sums.push(`${hash.digest("hex")}  ${names[index]}\n`);
  }
  const checksumFile = join(directory, "SHA256SUMS");
  await writeFile(checksumFile, sums.join(""));
  return [...files, checksumFile];
}

export async function publishDraft({ tag, repo, files, run = execFileAsync }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid GitHub repository");
  const gh = (args) => run("gh", [...args, "--repo", repo], { maxBuffer: 4 * 1024 * 1024 });
  // 查询失败必须阻断写入，不能把网络或鉴权故障误当成 Release 不存在。
  const { stdout } = await gh(["release", "list", "--limit", "1000", "--json", "tagName,isDraft"]);
  const existing = JSON.parse(stdout).find((release) => release.tagName === tag);
  if (existing && !existing.isDraft)
    throw new Error(`Refusing to overwrite published release ${tag}`);
  if (!existing) {
    await gh([
      "release",
      "create",
      tag,
      "--verify-tag",
      "--draft",
      ...(tag.includes("-") ? ["--prerelease"] : []),
      "--title",
      `ZCodium ${tag}`,
      "--generate-notes",
      "--notes",
      `${RELEASE_MESSAGE_HEADING}\n\n${RELEASE_MESSAGE_BODY}`,
    ]);
  }
  await gh(["release", "upload", tag, ...files, "--clobber"]);
}

async function main() {
  const [command, platform] = process.argv.slice(2);
  const root = resolve(import.meta.dirname, "../..");
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const artifacts = join(root, "dist", "release-assets");
  if (command === "check-version") {
    validateVersion(version);
    if (process.env.GITHUB_REF_TYPE === "tag") validateTag(process.env.GITHUB_REF_NAME, version);
    console.log(`Release version: ${version}`);
  } else if (command === "collect") {
    await collectArtifacts(join(root, "packages/desktop/dist"), artifacts, platform, version);
  } else if (command === "publish") {
    if (process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF_TYPE !== "tag") {
      throw new Error("Draft releases require a tag push");
    }
    const tag = process.env.GITHUB_REF_NAME;
    validateTag(tag, version);
    const files = await verifyReleaseAssets(artifacts, version);
    await publishDraft({ tag, repo: process.env.GITHUB_REPOSITORY, files });
  } else {
    throw new Error("Usage: desktop-release.mjs check-version | collect <linux|win> | publish");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
