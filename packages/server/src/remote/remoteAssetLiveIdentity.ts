import type { IRemoteBackend } from "@zcode/server/remote/backend.js";
import { REMOTE_BASE, waitForClose } from "@zcode/server/remote/deployShared.js";
import {
  buildWriteLiteralFileCommand,
  quotePosixPathArg,
} from "@zcode/server/remote/posixShell.js";
const REMOTE_ASSET_COMPONENT_META_DIR = `${REMOTE_BASE}/.asset-components`;

export interface RemoteAssetComponentIdentity {
  sha256: string;
}

export interface RemoteAssetComponentMeta {
  id: string;
  version?: string;
  sha256?: string;
  pendingRefreshAppVersion?: string;
  platformArch: string;
}

export type RemoteAssetComponentIdentityDecision =
  | { shouldDeploy: false }
  | { shouldDeploy: true; reason: string };

export async function checkRemoteAssetComponentIdentity(
  backend: IRemoteBackend,
  options: {
    componentId: string;
    platformArch: string;
    expectedIdentity: RemoteAssetComponentIdentity;
  },
): Promise<RemoteAssetComponentIdentityDecision> {
  const remoteMeta = await readRemoteAssetComponentMeta(backend, options.componentId);
  if (!remoteMeta) {
    return {
      shouldDeploy: true,
      reason: `remote component meta missing expected=${formatIdentity(options.expectedIdentity)}`,
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
  if (!remoteMeta.sha256) {
    // 旧 live marker 只记录 version，无法证明运行目录来自当前 manifest 制品。
    // 首次读取旧 marker 时必须重新部署并写入 SHA，不能继续按语义版本跳过。
    return {
      shouldDeploy: true,
      reason: `remote component SHA missing expected=${options.expectedIdentity.sha256}`,
    };
  }
  if (
    remoteMeta.sha256.trim().toLowerCase() !== options.expectedIdentity.sha256.trim().toLowerCase()
  ) {
    return {
      shouldDeploy: true,
      reason: `remote SHA mismatch remote=${remoteMeta.sha256} expected=${options.expectedIdentity.sha256}`,
    };
  }

  return { shouldDeploy: false };
}

export async function readRemoteAssetComponentMeta(
  backend: IRemoteBackend,
  componentId: string,
): Promise<RemoteAssetComponentMeta | null> {
  try {
    const content = await backend.readFile(buildRemoteAssetComponentMetaPath(componentId));
    const parsed = JSON.parse(content) as Partial<RemoteAssetComponentMeta>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.platformArch !== "string" ||
      (parsed.version !== undefined && typeof parsed.version !== "string") ||
      (parsed.sha256 !== undefined && typeof parsed.sha256 !== "string") ||
      (parsed.pendingRefreshAppVersion !== undefined &&
        typeof parsed.pendingRefreshAppVersion !== "string")
    ) {
      return null;
    }
    return {
      id: parsed.id,
      ...(parsed.version ? { version: parsed.version } : {}),
      ...(parsed.sha256 ? { sha256: parsed.sha256 } : {}),
      ...(parsed.pendingRefreshAppVersion
        ? { pendingRefreshAppVersion: parsed.pendingRefreshAppVersion }
        : {}),
      platformArch: parsed.platformArch,
    };
  } catch {
    return null;
  }
}

export async function writeRemoteAssetComponentMeta(
  backend: IRemoteBackend,
  meta: RemoteAssetComponentMeta,
): Promise<void> {
  // 其它资源包保持既有语义：无法解析版本时不写一个会永久失配的 unknown marker。
  if (meta.version === "unknown" && !meta.sha256) {
    return;
  }
  const stream = await backend.exec(
    [
      `mkdir -p ${quotePosixPathArg(REMOTE_ASSET_COMPONENT_META_DIR)}`,
      buildWriteLiteralFileCommand(
        buildRemoteAssetComponentMetaPath(meta.id),
        `${JSON.stringify(meta)}\n`,
      ),
    ].join(" && "),
  );
  await waitForClose(stream);
}

export async function markRemoteAssetComponentRefreshPending(
  backend: IRemoteBackend,
  options: {
    componentId: string;
    platformArch: string;
    appVersion: string;
  },
): Promise<void> {
  await writeRemoteAssetComponentMeta(backend, {
    id: options.componentId,
    platformArch: options.platformArch,
    pendingRefreshAppVersion: options.appVersion,
  });
}

export async function hasRemoteAssetComponentRefreshPending(
  backend: IRemoteBackend,
  options: { componentId: string; platformArch: string },
): Promise<boolean> {
  const meta = await readRemoteAssetComponentMeta(backend, options.componentId);
  return Boolean(
    meta &&
    meta.id === options.componentId &&
    meta.platformArch === options.platformArch &&
    meta.pendingRefreshAppVersion,
  );
}

function buildRemoteAssetComponentMetaPath(componentId: string): string {
  return `${REMOTE_ASSET_COMPONENT_META_DIR}/${componentId}.json`;
}

function formatIdentity(identity: RemoteAssetComponentIdentity): string {
  return identity.sha256;
}
