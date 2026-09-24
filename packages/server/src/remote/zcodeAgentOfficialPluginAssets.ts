import { remoteComponentRequiredPaths } from "@zcode/shared/bundled-remote-assets";
import {
  BUILTIN_PLUGIN_ASSETS,
  BUILTIN_PLUGIN_TOP_LEVEL_PATHS,
} from "@zcode/shared/builtin-plugin-assets";
import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

// 构建与部署共用必需文件，防止只验证 manifest 而复用缺少执行体的插件。
export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = BUILTIN_PLUGIN_ASSETS.map(
  ({ directory }) => directory,
);
export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = BUILTIN_PLUGIN_TOP_LEVEL_PATHS;
export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = remoteComponentRequiredPaths(
  "glm",
)
  .filter((path) => path.startsWith("packages/"))
  .map((path) => path.slice("packages/".length));

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
