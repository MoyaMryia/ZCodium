import { getRemoteRuntimeToolsForPlatform, type RemoteResourcePackageId } from "@zcode/shared";
import type { IRemoteBackend, RemoteEnvironment } from "@zcode/server/remote/backend.js";
import {
  REMOTE_BASE,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
  waitForClose,
} from "@zcode/server/remote/deployShared.js";
import type { RemoteAssetInstaller } from "@zcode/server/remote/remoteAssetInstaller.js";
import { buildWriteLiteralFileCommand } from "@zcode/server/remote/posixShell.js";

const REMOTE_TOOLS_BASE = `${REMOTE_BASE}/tools`;

export interface DeployRuntimeToolOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  installer: RemoteAssetInstaller;
  selectedResourcePackageIds?: RemoteResourcePackageId[];
}

export async function deployRuntimeTools(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options: DeployRuntimeToolOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const platformArch = options.platformArch;

  for (const { toolId, runtime, version } of getRemoteRuntimeToolsForPlatform(env.platform)) {
    const componentId = runtime.bundledResourceDir as RemoteResourcePackageId;
    if (
      options.selectedResourcePackageIds &&
      !options.selectedResourcePackageIds.includes(componentId)
    ) {
      loggers.log(`[tool-deploy] ${toolId}: 未选择资源包 ${componentId}，跳过检查和部署`);
      continue;
    }

    const entrySegments = runtime.resolveEntrySegments(env.platform);
    const binaryName = entrySegments[entrySegments.length - 1];
    if (!binaryName) {
      loggers.logWarn(`[tool-deploy] ${toolId}: 无法解析 binary 名称，跳过部署`);
      continue;
    }

    const remoteToolDir = `${REMOTE_TOOLS_BASE}/${runtime.bundledResourceDir}`;
    const remoteVersionFile = `${remoteToolDir}/.version`;
    const remoteBinaryPath = `${remoteToolDir}/${binaryName}`;

    const componentVersion = await options.installer.resolveComponentVersion?.(componentId);
    if (!componentVersion) throw new Error(`Bundled tool identity missing: ${componentId}`);
    let remoteVersion = "";
    try {
      remoteVersion = (await backend.readFile(remoteVersionFile)).trim();
    } catch {
      remoteVersion = "";
    }

    if (remoteVersion === componentVersion) {
      const hasRemoteBinary = await backend.exists(remoteBinaryPath);
      if (hasRemoteBinary) {
        loggers.log(`[tool-deploy] ${toolId}: 远程版本 ${version} 已是最新，跳过`);
        continue;
      }
      loggers.logWarn(
        `[remote-assets] upload required: component=${runtime.bundledResourceDir} reason=remote binary missing path=${remoteBinaryPath}`,
      );
    }

    loggers.log(`[tool-deploy] ${toolId}: 开始部署 ${version}`);
    await options.installer.installFile({
      componentId,
      sourceRelativePath: `tools/${platformArch}/${runtime.bundledResourceDir}/${binaryName}`,
      remotePath: remoteBinaryPath,
      executable: true,
    });

    const versionStream = await backend.exec(
      buildWriteLiteralFileCommand(remoteVersionFile, componentVersion),
    );
    await waitForClose(versionStream);
    loggers.log(`[tool-deploy] ${toolId}: 部署完成 ${version}`);
  }
}
