import { clientConfigReadOptionsSchema } from "@zcode/shared";
import type { IClientConfigService } from "./clientConfig.js";

/** Product presentation uses bundled defaults, independently of accounts and endpoints. */
export function createClientConfigService(): IClientConfigService {
  return {
    async getSnapshot(options = {}) {
      clientConfigReadOptionsSchema.parse(options);
      // null 保留商店 inventory 的默认排序，不再允许官方配置重排本地或自定义插件。
      return { pluginStoreOrder: null };
    },
  };
}
