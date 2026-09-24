import type { RemoteAssetInstaller } from "@zcode/server/remote/remoteAssetInstaller.js";
import type { IRemoteBackend, RemoteEnvironment } from "@zcode/server/remote/backend.js";
import {
  REMOTE_BASE,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
} from "@zcode/server/remote/deployShared.js";
import {
  readRemoteAssetComponentMeta,
  writeRemoteAssetComponentMeta,
} from "@zcode/server/remote/remoteAssetLiveIdentity.js";
const REMOTE_NODE_PTY_PATH = `${REMOTE_BASE}/build/Release/pty.node`;
const REMOTE_NODE_PTY_SPAWN_HELPER_PATH = `${REMOTE_BASE}/build/Release/spawn-helper`;

interface DeployNodePtyPrebuildOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  force?: boolean;
  onlyIfMissing: boolean;
  installer: RemoteAssetInstaller;
  expectedVersion?: string | null;
}

interface DeployNodeRuntimeOptions extends RemoteAssetDeployOptions {
  platformArch: string;
  force?: boolean;
  installer: RemoteAssetInstaller;
  expectedVersion?: string | null;
}

type DeployDecision = { shouldDeploy: false } | { shouldDeploy: true; reason: string };

export async function deployNodeRuntime(
  backend: IRemoteBackend,
  options: DeployNodeRuntimeOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const { platformArch, installer } = options;
  const remotePath = `${REMOTE_BASE}/node`;
  const expectedVersion = normalizeDeployExpectedVersion(options.expectedVersion);
  const decision = await shouldDeployVersionedComponent(backend, {
    componentId: "node-runtime",
    platformArch,
    remotePath,
    expectedVersion,
    force: options.force,
    fallbackDeployWhenVersionUnknown: true,
  });
  if (!decision.shouldDeploy) {
    loggers.log("node runtime already matches, skip");
    return;
  }

  logDeployRequired({
    loggers,
    installer,
    componentId: "node-runtime",
    reason: decision.reason,
  });
  await installer.installFile({
    componentId: "node-runtime",
    sourceRelativePath: `node/${platformArch}/node`,
    remotePath,
    executable: true,
  });
  await writeRemoteAssetComponentMeta(backend, {
    id: "node-runtime",
    version: expectedVersion ?? "unknown",
    platformArch,
  });
  loggers.log("node install done");
}

function normalizeDeployExpectedVersion(version: string | null | undefined): string | null {
  return version ?? null;
}

export async function deployNodePtyPrebuilds(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options: DeployNodePtyPrebuildOptions,
  loggers: DeployLoggers,
): Promise<void> {
  const { platformArch, onlyIfMissing, installer } = options;
  const expectedVersion = normalizeDeployExpectedVersion(options.expectedVersion);
  const decision = await shouldDeployVersionedComponent(backend, {
    componentId: "node-pty",
    platformArch,
    remotePath: REMOTE_NODE_PTY_PATH,
    expectedVersion,
    force: options.force,
    fallbackDeployWhenVersionUnknown: !onlyIfMissing,
  });
  if (decision.shouldDeploy) {
    const sourceRelativePath = `node-pty/${platformArch}/pty.node`;
    logDeployRequired({
      loggers,
      installer,
      componentId: "node-pty",
      reason: decision.reason,
    });
    loggers.log("installing node-pty prebuild...");
    await installer.installFile({
      componentId: "node-pty",
      sourceRelativePath,
      remotePath: REMOTE_NODE_PTY_PATH,
    });
    await writeRemoteAssetComponentMeta(backend, {
      id: "node-pty",
      version: expectedVersion ?? "unknown",
      platformArch,
    });
    loggers.log("node-pty install done");
  } else {
    loggers.log("node-pty prebuild already exists, skip");
  }

  if (env.platform !== "darwin") {
    return;
  }

  const shouldUploadSpawnHelper =
    decision.shouldDeploy || !(await backend.exists(REMOTE_NODE_PTY_SPAWN_HELPER_PATH));
  if (shouldUploadSpawnHelper) {
    const sourceRelativePath = `node-pty/${platformArch}/spawn-helper`;
    loggers.log("installing node-pty spawn-helper...");
    if (!decision.shouldDeploy) {
      logDeployRequired({
        loggers,
        installer,
        componentId: "node-pty",
        reason: `remote file missing path=${REMOTE_NODE_PTY_SPAWN_HELPER_PATH}`,
      });
    }
    await installer.installFile({
      componentId: "node-pty",
      sourceRelativePath,
      remotePath: REMOTE_NODE_PTY_SPAWN_HELPER_PATH,
      executable: true,
    });
    loggers.log("node-pty spawn-helper install done");
  } else {
    loggers.log("node-pty spawn-helper already exists, skip");
  }
}

async function shouldDeployVersionedComponent(
  backend: IRemoteBackend,
  options: {
    componentId: string;
    platformArch: string;
    remotePath: string;
    expectedVersion?: string | null;
    force?: boolean;
    fallbackDeployWhenVersionUnknown: boolean;
  },
): Promise<DeployDecision> {
  if (options.force) {
    return { shouldDeploy: true, reason: "force deploy requested" };
  }

  if (!(await backend.exists(options.remotePath))) {
    return {
      shouldDeploy: true,
      reason: `remote file missing path=${options.remotePath}`,
    };
  }

  if (!options.expectedVersion) {
    return options.fallbackDeployWhenVersionUnknown
      ? {
          shouldDeploy: true,
          reason: "component version unavailable, using legacy full deploy",
        }
      : { shouldDeploy: false };
  }

  const remoteMeta = await readRemoteAssetComponentMeta(backend, options.componentId);
  if (!remoteMeta) {
    return {
      shouldDeploy: true,
      reason: `remote component meta missing expected=${options.expectedVersion}`,
    };
  }
  if (remoteMeta.id !== options.componentId) {
    return {
      shouldDeploy: true,
      reason: `remote component id mismatch remote=${remoteMeta.id} expected=${options.componentId}`,
    };
  }
  if (remoteMeta.platformArch !== options.platformArch) {
    return {
      shouldDeploy: true,
      reason: `remote platform mismatch remote=${remoteMeta.platformArch} expected=${options.platformArch}`,
    };
  }
  if (
    normalizeDeployExpectedVersion(remoteMeta.version) !==
    normalizeDeployExpectedVersion(options.expectedVersion)
  ) {
    return {
      shouldDeploy: true,
      reason: `remote version mismatch remote=${remoteMeta.version} expected=${options.expectedVersion}`,
    };
  }

  return { shouldDeploy: false };
}

export function logDeployRequired(options: {
  loggers: Pick<DeployLoggers, "logWarn">;
  installer: RemoteAssetInstaller;
  componentId: string;
  reason: string;
}): void {
  const action = "upload required";
  options.loggers.logWarn(
    `[remote-assets] ${action}: component=${options.componentId} reason=${options.reason}`,
  );
}
