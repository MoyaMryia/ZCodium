import { ProviderRegistryService, EmptyAccountProviderConfigSource } from "@zcode/provider";
import {
  NodeProviderConfigRuntime,
  type NodeProviderConfigRuntimeOptions,
} from "./provider-config-runtime.js";

export type NodeProviderRegistryRuntimeOptions = NodeProviderConfigRuntimeOptions;

/** 一个 Node.js 进程内共享的 Config + Registry 生命周期。 */
export class NodeProviderRegistryRuntime {
  readonly configService: NodeProviderConfigRuntime["configService"];
  readonly registryService: ProviderRegistryService;
  readonly #configRuntime: NodeProviderConfigRuntime;
  #disposed = false;

  constructor(options: NodeProviderRegistryRuntimeOptions) {
    this.#configRuntime = new NodeProviderConfigRuntime(options);
    this.configService = this.#configRuntime.configService;
    this.registryService = new ProviderRegistryService({
      configSource: this.configService,
      accountSource: new EmptyAccountProviderConfigSource(this.configService),
    });
  }

  async start(): Promise<void> {
    this.#assertNotDisposed();
    await this.#configRuntime.start();
    return this.registryService.start();
  }

  get personalRepository(): NodeProviderConfigRuntime["personalRepository"] {
    return this.#configRuntime.personalRepository;
  }

  onDidCheckConfig(listener: () => Promise<void>): () => void {
    return this.#configRuntime.onDidCheckConfig(listener);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.registryService.dispose();
    this.#configRuntime.dispose();
  }

  #assertNotDisposed(): void {
    if (this.#disposed) throw new Error("NodeProviderRegistryRuntime 已 dispose");
  }
}

export function createNodeProviderRegistryRuntime(
  options: NodeProviderRegistryRuntimeOptions,
): NodeProviderRegistryRuntime {
  return new NodeProviderRegistryRuntime(options);
}
