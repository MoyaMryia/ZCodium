import { safeLogArgs } from "@zcode/shared";
/* eslint-disable max-lines -- 远端部署入口集中编排 server/node/agent/tool 资源，拆分需单独整理边界。 */
import {
  ZCODE_VERSION,
  formatLogPrefix,
  normalizeRemoteResourcePackageSelection,
  type RemoteResourcePackageId,
  type RemoteResourcePackageSelection,
} from "@zcode/shared";
import type { IRemoteBackend, RemoteEnvironment } from "./backend.js";
import { deployZCodeAgentRuntime } from "./zcodeAgentDeploy.js";
import {
  deployNodePtyPrebuilds,
  deployNodeRuntime,
  logDeployRequired,
} from "@zcode/server/remote/remoteAssetDeployDecision.js";
import { REMOTE_BASE } from "@zcode/server/remote/deployShared.js";
import { quotePosixPathArg } from "@zcode/server/remote/posixShell.js";
import { checkServerBundleRequiredMarkers } from "@zcode/server/remote/serverBundleDeployCheck.js";
import { deployRuntimeTools } from "@zcode/server/remote/runtimeToolDeploy.js";
import { LocalUploadAssetInstaller } from "@zcode/server/remote/remoteAssetInstaller.js";
import { BundledRemoteSource } from "@zcode/server/remote/bundledRemoteSource.js";
import {
  checkRemoteAssetComponentIdentity,
  hasRemoteAssetComponentRefreshPending,
  markRemoteAssetComponentRefreshPending,
  writeRemoteAssetComponentMeta,
} from "@zcode/server/remote/remoteAssetLiveIdentity.js";
import { assertSupportedRemoteEnvironment } from "@zcode/server/remote/remotePlatformSupport.js";
import { acquireRemoteDeployLock } from "@zcode/server/remote/remoteDeployLock.js";

const log = (...args: unknown[]) =>
  console.log(...safeLogArgs([formatLogPrefix("deploy", process.pid), ...args]));
const logWarn = (...args: unknown[]) =>
  console.warn(...safeLogArgs([formatLogPrefix("deploy", process.pid), ...args]));
const SERVER_BUNDLE_COMPONENT_ID = "server-bundle";

export type DeployLockMode = "remote" | "caller-serialized";

export interface DeployOptions {
  /** 取消当前远端连接初始化与其拥有的上传。 */
  signal?: AbortSignal;
  /** Read-only component archives and manifest shipped with this application. */
  bundledRemoteAssetsDir?: string;
  /** Force deploy even if versions match */
  force?: boolean;
  /** 等待远端 install-root deploy lock 的总 deadline，默认 120 秒。 */
  deployLockAcquireTimeoutMs?: number;
  /** 部署串行化边界；默认由远端 install-root lock 保证。 */
  deployLockMode?: DeployLockMode;
  /** 只在选中资源包范围内做远端部署检查和上传。 */
  resourcePackages?: RemoteResourcePackageSelection;
}

/**
 * Deploy the zcode server to the remote machine.
 * Uploads Node.js binary, server bundle, and node-pty prebuild.
 *
 * Returns true if a deploy was performed, false if skipped (version matches).
 */
export async function deployServer(
  backend: IRemoteBackend,
  env: RemoteEnvironment,
  options?: DeployOptions,
): Promise<boolean> {
  const platformArch = `${env.platform}-${env.arch}`;
  assertSupportedRemoteEnvironment(env);
  const selectedResourcePackageIds = normalizeRemoteResourcePackageSelection();
  const shouldDeployResourcePackage = (packageId: RemoteResourcePackageId): boolean =>
    selectedResourcePackageIds.includes(packageId);
  const source = new BundledRemoteSource({
    directory: options?.bundledRemoteAssetsDir ?? "",
    appVersion: ZCODE_VERSION,
    platformArch,
    signal: options?.signal,
  });
  const getComponent = async (id: string) => {
    const component = (await source.getManifest()).components.find((entry) => entry.id === id);
    if (!component) throw new Error(`Bundled remote component missing: ${id}`);
    return component;
  };
  const getComponentSha256 = async (id: string) => (await getComponent(id)).sha256;
  const getExpectedComponentVersion = async (id: string) => (await getComponent(id)).version;
  const assetDeployOptions = {
    signal: options?.signal,
    resolveReleaseDir: () => source.resolveReleaseDir(),
    resolveComponentSha256: getComponentSha256,
    resolveComponentVersion: getExpectedComponentVersion,
  };
  const installer = new LocalUploadAssetInstaller(
    backend,
    {
      ...assetDeployOptions,
      platformArch,
      version: ZCODE_VERSION,
    },
    { log, logWarn },
  );
  log("remote env:", platformArch);
  log("selected remote resource packages:", selectedResourcePackageIds.join(","));

  const deployWithDecision = async (
    serverDeployDecision: ServerDeployDecision,
    expectedServerBundleSha256: string | null,
  ): Promise<boolean> => {
    const hasPendingAppVersionRefresh = await hasRemoteAssetComponentRefreshPending(backend, {
      componentId: "glm",
      platformArch,
    });
    const shouldForceRefreshContentAddressedAssets =
      Boolean(options?.force) ||
      hasPendingAppVersionRefresh ||
      (serverDeployDecision.shouldDeploy && serverDeployDecision.appVersionChanged === true);

    if (shouldForceRefreshContentAddressedAssets) {
      // server 会先于 GLM 更新；若后续步骤失败，下次连接时 server 版本
      // 已经匹配。必须持久化升级强刷状态，让重试继续绕过旧 SHA marker，直到 GLM 成功覆盖 marker。
      await markRemoteAssetComponentRefreshPending(backend, {
        componentId: "glm",
        platformArch,
        appVersion: ZCODE_VERSION,
      });
    }

    await deployNodeRuntime(
      backend,
      {
        ...assetDeployOptions,
        platformArch,
        force: Boolean(options?.force),
        installer,
        expectedVersion: await getExpectedComponentVersion("node-runtime"),
      },
      { log, logWarn },
    );

    // Check if deploy is needed
    if (!serverDeployDecision.shouldDeploy) {
      log("skipped — remote version matches");
      // 主 server 版本相同只证明 node/zcode-server.cjs 可启动，不代表随包工具仍存在。
      // glm 内容跟随 app/server 版本刷新；但 wrapper/bundle 被清理或制品内容变化时仍要按实体检查修复。
      if (shouldDeployResourcePackage("node-pty")) {
        await deployNodePtyPrebuilds(
          backend,
          env,
          {
            ...assetDeployOptions,
            platformArch,
            onlyIfMissing: true,
            installer,
            expectedVersion: await getExpectedComponentVersion("node-pty"),
          },
          { log, logWarn },
        );
      }
      await deployZCodeAgentRuntime(
        backend,
        env,
        {
          ...assetDeployOptions,
          platformArch,
          installer,
          force: shouldForceRefreshContentAddressedAssets,
          selectedResourcePackageIds,
        },
        { log, logWarn },
      );
      await deployRuntimeTools(
        backend,
        env,
        {
          ...assetDeployOptions,
          platformArch,
          installer,
          selectedResourcePackageIds,
        },
        { log, logWarn },
      );
      return false;
    }

    logDeployRequired({
      loggers: { logWarn },
      installer,
      componentId: SERVER_BUNDLE_COMPONENT_ID,
      reason: serverDeployDecision.reason,
    });
    await installer.installFile({
      componentId: SERVER_BUNDLE_COMPONENT_ID,
      sourceRelativePath: "server/zcode-server.cjs",
      remotePath: `${REMOTE_BASE}/zcode-server.cjs`,
      // App 版本变化是新的发布边界，不能只凭历史 cache 的 `.ready`
      // 判断 server-bundle 可复用；与 GLM 一致，必须重新读取并校验当前随包制品。
      forceRefresh: shouldForceRefreshContentAddressedAssets,
    });
    if (expectedServerBundleSha256) {
      // App/version 相同不代表 server-bundle 制品相同。安装成功后才写
      // manifest SHA marker，避免失败重试把旧 server 误判成当前制品。
      await writeRemoteAssetComponentMeta(backend, {
        id: SERVER_BUNDLE_COMPONENT_ID,
        sha256: expectedServerBundleSha256,
        platformArch,
      });
    }
    log("server install done");

    if (shouldDeployResourcePackage("node-pty")) {
      await deployNodePtyPrebuilds(
        backend,
        env,
        {
          ...assetDeployOptions,
          platformArch,
          force: Boolean(options?.force),
          onlyIfMissing: false,
          installer,
          expectedVersion: await getExpectedComponentVersion("node-pty"),
        },
        { log, logWarn },
      );
    }

    log("all uploads complete");

    // 部署 ZCode Agent runtime 到远程，历史资源包选择已在入口统一忽略。
    await deployZCodeAgentRuntime(
      backend,
      env,
      {
        ...assetDeployOptions,
        platformArch,
        installer,
        // 旧版 App 会覆盖 agents/glm，却不会同步新版引入的 GLM SHA marker。
        // App 版本变化后该 marker 可能与实际 bundle 不一致，必须绕过旧 marker，
        // 按当前 App 的 manifest 重新上传并部署；同 App 版本内仍按 SHA 精确判断。
        force: shouldForceRefreshContentAddressedAssets,
        selectedResourcePackageIds,
      },
      { log, logWarn },
    );
    await deployRuntimeTools(
      backend,
      env,
      {
        ...assetDeployOptions,
        platformArch,
        installer,
        selectedResourcePackageIds,
      },
      { log, logWarn },
    );

    return true;
  };

  const deployUsingCurrentRemoteState = async (): Promise<boolean> => {
    try {
      const expectedServerBundleSha256 = await getComponentSha256(SERVER_BUNDLE_COMPONENT_ID);
      const decision = options?.force
        ? {
            shouldDeploy: true,
            reason: "force deploy requested",
          }
        : await checkServerDeployDecision(backend, {
            platformArch,
            expectedSha256: expectedServerBundleSha256,
          });
      return await deployWithDecision(decision, expectedServerBundleSha256);
    } finally {
      await source.dispose();
    }
  };

  if (options?.deployLockMode === "caller-serialized") {
    // 桌面 SSH 已由窗口级 shared Host readiness 保证同一 target 只有一个部署事务；
    // 若仍创建 remote lock-holder，会为无额外互斥收益的路径长期占用 SSH channel。
    // 该模式必须由已具备 single-flight 的调用方显式注入，WSL/Docker 和其他调用继续默认远端锁。
    return deployUsingCurrentRemoteState();
  }

  const preLockDecision = options?.force
    ? { shouldDeploy: true as const, reason: "force deploy requested" }
    : await checkServerDeployDecision(backend, {
        platformArch,
        expectedSha256: null,
      });
  if (preLockDecision.shouldDeploy) {
    log(`waiting for install-root lock: ${preLockDecision.reason}`);
  }
  const deployLock = await acquireRemoteDeployLock(backend, {
    acquireTimeoutMs: options?.deployLockAcquireTimeoutMs,
  });
  let deployOutcome: { ok: true; value: boolean } | { ok: false; error: unknown };
  try {
    // 进程内 WSL single-flight 无法覆盖不同 Desktop/build/backend。
    // 获得远端 install-root lock 后必须重新检查，等待者不能按过期判断重复覆盖部署目录。
    deployOutcome = {
      ok: true,
      value: await deployUsingCurrentRemoteState(),
    };
  } catch (error) {
    deployOutcome = { ok: false, error };
  }

  let releaseOutcome: { ok: true } | { ok: false; error: unknown };
  try {
    await deployLock.release();
    releaseOutcome = { ok: true };
  } catch (error) {
    releaseOutcome = { ok: false, error };
  }
  if (!deployOutcome.ok && !releaseOutcome.ok) {
    // finally 内直接抛 release 错误会覆盖真正的部署失败，排障只能看到次生症状。
    // AggregateError 同时保留 deploy 与 release 两条因果链，且 release deadline 保证这里有界返回。
    throw new AggregateError(
      [deployOutcome.error, releaseOutcome.error],
      "remote deployment and deploy-lock release both failed",
    );
  }
  if (!deployOutcome.ok) {
    throw deployOutcome.error;
  }
  if (!releaseOutcome.ok) {
    throw releaseOutcome.error;
  }
  return deployOutcome.value;
}

type ServerDeployDecision =
  | { shouldDeploy: false }
  | {
      shouldDeploy: true;
      reason: string;
      appVersionChanged?: boolean;
    };

async function checkServerDeployDecision(
  backend: IRemoteBackend,
  options: {
    platformArch: string;
    expectedSha256: string | null;
  },
): Promise<ServerDeployDecision> {
  try {
    log("checking if deploy needed...");
    const nodePath = `${REMOTE_BASE}/node`;
    const exists = await backend.exists(nodePath);
    log("remote node exists:", exists);
    if (!exists) {
      return {
        shouldDeploy: true,
        reason: `remote file missing path=${nodePath}`,
      };
    }

    const serverPath = `${REMOTE_BASE}/zcode-server.cjs`;
    const serverExists = await backend.exists(serverPath);
    log("remote server exists:", serverExists);
    if (!serverExists) {
      return {
        shouldDeploy: true,
        reason: `remote file missing path=${serverPath}`,
      };
    }

    // Check version
    log("checking remote version...");
    const stream = await backend.exec(
      `${quotePosixPathArg(nodePath)} ${quotePosixPathArg(serverPath)} --version`,
    );
    const version = (await collectStdout(stream)).trim();
    log("remote version:", JSON.stringify(version), "local:", ZCODE_VERSION);
    if (version !== ZCODE_VERSION) {
      return {
        shouldDeploy: true,
        reason: `remote server version mismatch remote=${version} expected=${ZCODE_VERSION}`,
        appVersionChanged: true,
      };
    }
    const requiredFeatureDecision = await checkServerBundleRequiredMarkers(
      backend,
      nodePath,
      serverPath,
    );
    if (requiredFeatureDecision.shouldDeploy) {
      return requiredFeatureDecision;
    }
    if (options.expectedSha256) {
      const identityDecision = await checkRemoteAssetComponentIdentity(backend, {
        componentId: SERVER_BUNDLE_COMPONENT_ID,
        platformArch: options.platformArch,
        expectedIdentity: { sha256: options.expectedSha256 },
      });
      if (identityDecision.shouldDeploy) {
        return identityDecision;
      }
    }
    return { shouldDeploy: false };
  } catch (err) {
    log("checkServerDeployDecision error (will deploy):", err);
    return {
      shouldDeploy: true,
      reason: `remote deploy check failed: ${String(err)}`,
    };
  }
}

function collectStdout(stream: import("./backend.js").StdioStream): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    stream.stdout.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    stream.onClose(() => resolve(data));
  });
}
