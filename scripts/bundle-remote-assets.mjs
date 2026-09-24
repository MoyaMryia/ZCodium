import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";
import { verifyArchiveSha256 } from "./remote-node-runtime.mjs";

const { BUNDLED_REMOTE_MANIFEST, parseBundledRemoteManifest, remoteComponentRequiredPaths } =
  await tsImport("@zcode/shared/bundled-remote-assets", import.meta.url);
export { remoteComponentRequiredPaths };
const run = promisify(execFile);

async function containedFile(directory, path) {
  const root = await realpath(directory);
  const file = await realpath(join(root, path));
  const rel = relative(root, file);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    !(await stat(file)).isFile()
  ) {
    throw new Error(`Invalid remote component file: ${path}`);
  }
  return file;
}

export async function verifyBundledRemoteAssets(directory, version) {
  const manifest = parseBundledRemoteManifest(
    JSON.parse(await readFile(join(directory, BUNDLED_REMOTE_MANIFEST), "utf8")),
    version,
  );
  for (const component of manifest.components) {
    await verifyArchiveSha256(
      await containedFile(directory, component.artifactPath),
      component.sha256,
    );
  }
  return manifest;
}

export async function bundleRemoteAssets({
  sourceDirectory,
  outputDirectory,
  version,
  sourceCommit,
  sourceDirty = false,
}) {
  // 失败的重建必须撤销旧发布标记，否则打包脚本可能把上一次产物当作本次成功。
  await rm(outputDirectory, { recursive: true, force: true });
  const releaseDirectory = join(sourceDirectory, "releases", version);
  const source = JSON.parse(
    await readFile(join(releaseDirectory, BUNDLED_REMOTE_MANIFEST), "utf8"),
  );
  const manifest = parseBundledRemoteManifest({ ...source, sourceCommit, sourceDirty }, version);
  for (const component of manifest.components) {
    for (const required of remoteComponentRequiredPaths(component.id)) {
      await containedFile(releaseDirectory, join(component.mount, required)).catch((error) => {
        throw new Error(`Missing remote component input: ${component.id}/${required}`, {
          cause: error,
        });
      });
    }
    const archive = await containedFile(sourceDirectory, component.artifactPath);
    await verifyArchiveSha256(archive, component.sha256);
    const target = join(outputDirectory, component.artifactPath);
    await mkdir(dirname(target), { recursive: true });
    // 复制归档字节而非解包目录，Windows artifact 消费端不会丢 Linux 执行权限。
    await copyFile(archive, target);
    await verifyArchiveSha256(target, component.sha256);
  }
  await mkdir(outputDirectory, { recursive: true });
  const manifestPath = join(outputDirectory, BUNDLED_REMOTE_MANIFEST);
  await writeFile(`${manifestPath}.part`, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(`${manifestPath}.part`, manifestPath);
  return manifest;
}

export async function bundleRepositoryRemoteAssets(root) {
  const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: root });
  const { stdout: dirty } = await run("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
  });
  return bundleRemoteAssets({
    sourceDirectory: join(root, "packages/desktop/mock-cdn"),
    outputDirectory: join(root, "packages/desktop/bundled-remote-assets"),
    version,
    sourceCommit: stdout.trim(),
    sourceDirty: Boolean(dirty.trim()),
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const root = resolve(import.meta.dirname, "..");
  if (process.argv[2] === "verify") {
    const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    await verifyBundledRemoteAssets(
      resolve(process.argv[3] || join(root, "packages/desktop/bundled-remote-assets")),
      version,
    );
  } else if (process.argv.length === 2) {
    await bundleRepositoryRemoteAssets(root);
  } else {
    throw new Error("Usage: node scripts/bundle-remote-assets.mjs [verify [directory]]");
  }
}
