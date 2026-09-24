import type { IClientScenesService } from "./clientScenes.js";
import { readBundledClientScenes } from "./bundledClientScenes.js";

export function createClientScenesService(): IClientScenesService {
  return {
    async list() {
      return { code: 0, msg: "", data: readBundledClientScenes() };
    },
  };
}
