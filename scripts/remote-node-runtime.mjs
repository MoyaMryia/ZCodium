import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { stageNodeNotices } from "./third-party-notices.mjs";

const run = promisify(execFile);
export const REMOTE_NODE_VERSION = "v22.16.0";
export const DEFAULT_NODE_DIST_BASE = "https://nodejs.org/dist";

export function nodeDistBase(env = process.env) {
  return (env.ZCODE_NODE_DIST_MIRROR?.trim() || DEFAULT_NODE_DIST_BASE).replace(/\/+$/u, "");
}

export function remoteNodeDistribution(platform) {
  if (platform !== "linux-x64") throw new Error(`Unsupported remote platform: ${platform}`);
  return {
    version: REMOTE_NODE_VERSION,
    archiveName: `node-${REMOTE_NODE_VERSION}-${platform}.tar.xz`,
    member: `node-${REMOTE_NODE_VERSION}-${platform}/bin/node`,
    // https://nodejs.org/dist/v22.16.0/SHASUMS256.txt
    sha256: "f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e",
  };
}

export async function verifyArchiveSha256(path, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== expected) throw new Error(`SHA256 mismatch: ${path}`);
}

/** Build-time acquisition only. Existing archives are checked on every use. */
export async function acquireVerifiedArchive({ archivePath, url, sha256, fetchImpl = fetch }) {
  const cached = await stat(archivePath).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (cached) {
    await verifyArchiveSha256(archivePath, sha256);
    return archivePath;
  }
  await mkdir(dirname(archivePath), { recursive: true });
  const temporary = `${archivePath}.${randomUUID()}.part`;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) throw new Error(`Node archive HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(temporary, { flags: "wx" }));
    await verifyArchiveSha256(temporary, sha256);
    await rename(temporary, archivePath);
    return archivePath;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function prepareRemoteNode({ platform, outputDirectory, cacheDirectory, root }) {
  const distribution = remoteNodeDistribution(platform);
  const archivePath = await acquireVerifiedArchive({
    archivePath: join(cacheDirectory, distribution.archiveName),
    url: `${nodeDistBase()}/${distribution.version}/${distribution.archiveName}`,
    sha256: distribution.sha256,
  });
  await mkdir(dirname(outputDirectory), { recursive: true });
  const staging = await mkdtemp(`${outputDirectory}.staging-`);
  try {
    // 旧解包目录只检查存在会混入旧版本或损坏文件；每次从已校验归档重新生成。
    // 使用相对归档名，避免 Windows tar 把盘符冒号误判为远程主机。
    await run(
      "tar",
      [
        "-xJf",
        distribution.archiveName,
        "--strip-components=2",
        "-C",
        staging.replaceAll("\\", "/"),
        distribution.member,
      ],
      { cwd: dirname(archivePath) },
    );
    await chmod(join(staging, "node"), 0o755);
    await stageNodeNotices(staging, distribution.version, root);
    await rm(outputDirectory, { recursive: true, force: true });
    await rename(staging, outputDirectory);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
