import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  BUNDLED_REMOTE_MANIFEST,
  BUNDLED_REMOTE_PLATFORM,
  parseBundledRemoteManifest,
  type BundledRemoteManifest,
} from "@zcode/shared/bundled-remote-assets";
import { extractTarGzBuffer } from "@zcode/server/remote/localTarGz.js";

type Component = BundledRemoteManifest["components"][number];

async function containedFile(directory: string, path: string): Promise<string> {
  const root = await realpath(directory);
  const file = await realpath(join(root, path));
  const rel = relative(root, file);
  if (
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    !(await stat(file)).isFile()
  ) {
    throw new Error(`Invalid bundled remote file: ${path}`);
  }
  return file;
}

/** One deployment owns the manifest snapshot and its temporary, verified extraction. */
export class BundledRemoteSource {
  private manifestPromise: Promise<BundledRemoteManifest> | undefined;
  private directoryPromise: Promise<string> | undefined;
  private disposed = false;

  constructor(
    private readonly options: {
      directory: string;
      appVersion: string;
      platformArch: string;
      temporaryRoot?: string;
      signal?: AbortSignal;
    },
  ) {
    if (options.platformArch !== BUNDLED_REMOTE_PLATFORM) {
      throw new Error(`Unsupported bundled remote platform: ${options.platformArch}`);
    }
    if (!options.directory)
      throw new Error("Bundled remote assets are missing; rebuild or reinstall ZCodium");
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("Bundled remote source disposed");
    this.options.signal?.throwIfAborted();
  }

  getManifest(): Promise<BundledRemoteManifest> {
    try {
      this.assertActive();
      this.manifestPromise ??= this.readManifest();
      return this.manifestPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async readArchive(component: Component): Promise<Buffer> {
    this.assertActive();
    const path = await containedFile(this.options.directory, component.artifactPath);
    const bytes = await readFile(path, { signal: this.options.signal });
    if (createHash("sha256").update(bytes).digest("hex") !== component.sha256) {
      throw new Error(`Bundled remote SHA256 mismatch: ${component.id}`);
    }
    return bytes;
  }

  private async readManifest(): Promise<BundledRemoteManifest> {
    const path = await containedFile(this.options.directory, BUNDLED_REMOTE_MANIFEST);
    const manifest = parseBundledRemoteManifest(
      JSON.parse(await readFile(path, "utf8")),
      this.options.appVersion,
    );
    // 版本匹配也先检查完整安装包，缺件时绝不通过旧 CDN cache 补齐。
    for (const component of manifest.components) await this.readArchive(component);
    this.assertActive();
    return manifest;
  }

  resolveReleaseDir(): Promise<string> {
    try {
      this.assertActive();
      this.directoryPromise ??= this.materialize();
      return this.directoryPromise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private async materialize(): Promise<string> {
    const manifest = await this.getManifest();
    this.assertActive();
    const directory = await mkdtemp(
      join(this.options.temporaryRoot ?? tmpdir(), "zcodium-remote-"),
    );
    try {
      for (const component of manifest.components) {
        // 校验与解包使用同一份字节，避免 manifest 固定后文件变化绕过校验。
        const bytes = await this.readArchive(component);
        const destination = join(directory, component.mount);
        await mkdir(destination, { recursive: true });
        await extractTarGzBuffer(bytes, destination);
        for (const requiredPath of component.requiredPaths) {
          await containedFile(destination, requiredPath);
        }
        this.assertActive();
      }
      await writeFile(join(directory, BUNDLED_REMOTE_MANIFEST), JSON.stringify(manifest));
      this.assertActive();
      return directory;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const directory = await this.directoryPromise?.catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
