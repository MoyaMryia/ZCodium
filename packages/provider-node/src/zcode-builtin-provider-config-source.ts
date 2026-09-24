import { watch, type FSWatcher } from "node:fs";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import type { ProviderConfigLayerSnapshot, ProviderSource } from "@zcode/provider";
import {
  decodeZCodeBuiltinRelease,
  serializeZCodeBuiltinRelease,
  type ZCodeBuiltinRelease,
} from "./zcode-builtin-release.js";

export interface NodeZCodeBuiltinProviderConfigSourceOptions {
  readonly bundledFilePath: string;
  readonly watch?: boolean;
}

/** 只读随包配置；个人配置由独立 Repository 管理。 */
export class NodeZCodeBuiltinProviderConfigSource implements ProviderSource<ProviderConfigLayerSnapshot> {
  readonly #bundledFilePath: string;
  readonly #sourceKey: string;
  readonly #watchEnabled: boolean;
  readonly #listeners = new Set<(reason: string) => void>();
  #watcher: FSWatcher | null = null;
  #observedSignature: string | null = null;
  #watchRefresh = Promise.resolve();
  #disposed = false;

  constructor(options: NodeZCodeBuiltinProviderConfigSourceOptions) {
    const bundledFilePath = options.bundledFilePath.trim();
    if (!bundledFilePath) throw new Error("ZCode Built-in bundledFilePath 不能为空");
    this.#bundledFilePath = bundledFilePath;
    // Host 与 Worker 使用同一路径隔离来源，内容身份另计，避免同序号更新被忽略。
    this.#sourceKey = createHash("sha256").update(resolve(bundledFilePath)).digest("hex");
    this.#watchEnabled = options.watch !== false;
  }

  get filePath(): string {
    return this.#bundledFilePath;
  }

  async read(): Promise<ProviderConfigLayerSnapshot> {
    this.#assertNotDisposed();
    this.#ensureWatcher();
    const release = await this.#readRelease();
    this.#observedSignature ??= signatureOf(release);
    return snapshotFromRelease(release, this.#sourceKey);
  }

  async #readRelease(): Promise<ZCodeBuiltinRelease> {
    // 历史 Active/LKG 可能来自官方服务，即使版本更高也不能覆盖本地基线。
    return decodeZCodeBuiltinRelease(JSON.parse(await readFile(this.#bundledFilePath, "utf8")));
  }

  onDidChange(listener: (reason: string) => void): () => void {
    this.#assertNotDisposed();
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#watcher?.close();
    this.#watcher = null;
    this.#listeners.clear();
  }

  #ensureWatcher(): void {
    if (!this.#watchEnabled || this.#watcher || this.#disposed) return;
    const target = basename(this.#bundledFilePath);
    this.#watcher = watch(dirname(this.#bundledFilePath), (_eventType, fileName) => {
      if (fileName === null || fileName.toString() === target) this.#scheduleWatchRefresh();
    });
    this.#watcher.on("error", () => this.#emit("watch-error"));
  }

  #scheduleWatchRefresh(): void {
    this.#watchRefresh = this.#watchRefresh.then(async () => {
      if (this.#disposed) return;
      try {
        const release = await this.#readRelease();
        const signature = signatureOf(release);
        if (this.#disposed || signature === this.#observedSignature) return;
        this.#observedSignature = signature;
        this.#emit("file-changed");
      } catch {
        this.#emit("watch-error");
      }
    });
  }

  #emit(reason: string): void {
    if (this.#disposed) return;
    for (const listener of this.#listeners) listener(reason);
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("NodeZCodeBuiltinProviderConfigSource 已 dispose");
  }
}

export function createNodeZCodeBuiltinProviderConfigSource(
  options: NodeZCodeBuiltinProviderConfigSourceOptions,
): NodeZCodeBuiltinProviderConfigSource {
  return new NodeZCodeBuiltinProviderConfigSource(options);
}

function snapshotFromRelease(
  release: ZCodeBuiltinRelease,
  sourceKey: string,
): ProviderConfigLayerSnapshot {
  return Object.freeze({
    revision: `zcode-builtin:${release.revision}:${sourceKey}:${signatureOf(release)}`,
    providers: release.config.providers,
    providerTemplates: release.config.providerTemplates,
    models: release.config.modelConfigRules,
  });
}

function signatureOf(release: ZCodeBuiltinRelease): string {
  return createHash("sha256").update(serializeZCodeBuiltinRelease(release)).digest("hex");
}
