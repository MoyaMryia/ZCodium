import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHelpAppConfig, type HelpAppConfig } from "@zcode/shared";

export async function readDesktopHelpConfig(options: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): Promise<HelpAppConfig> {
  // 正式包的 appPath 是 resources/app.asar；配置实际位于 resources/config。
  const configPath = options.isPackaged
    ? join(options.resourcesPath, "config/default.json")
    : join(options.appPath, "../../config/default.json");
  return resolveHelpAppConfig(JSON.parse(await readFile(configPath, "utf8")));
}
