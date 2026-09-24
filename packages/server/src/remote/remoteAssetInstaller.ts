import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import type { IRemoteBackend } from "@zcode/server/remote/backend.js";
import {
  buildRemoteExecutableReplaceCommand,
  buildRemoteMoveCommand,
  createRemoteAssetPlaceholderError,
  fileExists,
  type DeployLoggers,
  type RemoteAssetDeployOptions,
  waitForClose,
} from "@zcode/server/remote/deployShared.js";
import { quotePosixPathArg, quotePosixShellArg } from "@zcode/server/remote/posixShell.js";
import { createTarGzArchive } from "@zcode/server/remote/localTarGz.js";
import {
  detectRemoteAssetTools,
  type RemoteAssetTools,
  type RemoteSha256Tool,
} from "@zcode/server/remote/remoteAssetPreflight.js";

export interface RemoteAssetInstaller {
  readonly mode: "bundled-upload";
  resolveComponentVersion?(componentId: string): Promise<string | null>;
  resolveComponentSha256?(componentId: string): Promise<string | null>;
  installFile(params: {
    componentId: string;
    sourceRelativePath: string;
    remotePath: string;
    executable?: boolean;
    forceRefresh?: boolean;
  }): Promise<void>;
  installDirectory(params: {
    componentId: string;
    sourceRelativePath: string;
    remoteDir: string;
    requiredRelativePaths?: string[];
    forceRefresh?: boolean;
  }): Promise<void>;
}

function throwIfRemoteAssetInstallAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  const error = new Error("Remote asset installation canceled");
  error.name = "AbortError";
  throw error;
}

function buildStaleRemoteStagingCleanupCommand(parentDir: string, patterns: string[]): string {
  const quotedParentDir = quotePosixPathArg(parentDir);
  const candidateExpressions = patterns.map((pattern) => {
    const literalPrefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    return `${quotedParentDir}/${quotePosixShellArg(literalPrefix)}*`;
  });
  return [
    `for candidate in ${candidateExpressions.join(" ")}; do`,
    'test -e "$candidate" || continue',
    // SSH 取消会先释放旧 backend，不能再用旧凭据立即 cleanup。
    // 新连接只回收超过 24 小时的 ZCode owner staging，避免误删当前 owner 或正常时长内的活跃部署。
    'find "$candidate" -prune -mtime +0 -exec rm -rf {} + 2>/dev/null || true',
    "done",
  ].join("\n");
}

export function buildRemoteChecksumCommand(params: {
  tool: RemoteSha256Tool;
  filePath: string;
}): string {
  const file = quotePosixPathArg(params.filePath);
  if (params.tool === "sha256sum") {
    return `sha256sum ${file} | awk '{print $1}'`;
  }
  if (params.tool === "shasum") {
    return `shasum -a 256 ${file} | awk '{print $1}'`;
  }
  return `openssl dgst -sha256 ${file} | awk '{print $NF}'`;
}

export class LocalUploadAssetInstaller implements RemoteAssetInstaller {
  readonly mode = "bundled-upload" as const;
  private toolsPromise: Promise<RemoteAssetTools> | undefined;

  private async verifyUploadedFile(localPath: string, remotePath: string): Promise<void> {
    throwIfRemoteAssetInstallAborted(this.options.signal);
    this.toolsPromise ??= detectRemoteAssetTools(this.backend, this.loggers);
    const tools = await this.toolsPromise;
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(localPath)) hash.update(bytes);
    const expected = hash.digest("hex");
    throwIfRemoteAssetInstallAborted(this.options.signal);
    // SFTP/WSL 上传完成不等于落盘字节正确；校验必须早于正式文件替换。
    const command = buildRemoteChecksumCommand({ tool: tools.sha256, filePath: remotePath });
    const stream = await this.backend.exec(
      `test "$( ${command} )" = ${quotePosixShellArg(expected)}`,
    );
    await waitForClose(stream);
    throwIfRemoteAssetInstallAborted(this.options.signal);
  }

  constructor(
    private readonly backend: IRemoteBackend,
    private readonly options: RemoteAssetDeployOptions & {
      platformArch?: string;
      version?: string;
    },
    private readonly loggers: DeployLoggers,
  ) {}

  async resolveComponentVersion(componentId: string): Promise<string | null> {
    return (await this.options.resolveComponentVersion?.(componentId)) ?? null;
  }

  async resolveComponentSha256(componentId: string): Promise<string | null> {
    return (await this.options.resolveComponentSha256?.(componentId)) ?? null;
  }

  async tryResolveLocalPath(
    componentIds: string[],
    sourceRelativePath: string,
    requiredReleasePaths?: string[],
    forceRefresh = false,
  ): Promise<string | null> {
    const releaseDir =
      this.options.releaseDir ??
      (await this.options.resolveReleaseDir?.(componentIds, {
        forceRefresh,
      })) ??
      null;
    if (!releaseDir) {
      return null;
    }

    const localPath = join(releaseDir, sourceRelativePath);
    if (await fileExists(localPath)) {
      const missingRequiredPaths = await findMissingLocalRequiredReleasePaths(
        releaseDir,
        requiredReleasePaths,
      );
      if (missingRequiredPaths.length === 0) {
        return localPath;
      }
      // 解包目录可能已经有 packages 父目录，但缺少本次部署要求的 plugin.json。
      // 这里不能只看父目录存在，否则会继续上传残缺官方插件资源。
      this.loggers.logWarn(
        `[remote-assets] local release asset incomplete: source=${localPath} missing=${missingRequiredPaths.join(",")}`,
      );
    }

    return null;
  }

  async resolveLocalPath(
    componentIds: string[],
    sourceRelativePath: string,
    requiredReleasePaths?: string[],
    forceRefresh = false,
  ): Promise<string> {
    const localPath = await this.tryResolveLocalPath(
      componentIds,
      sourceRelativePath,
      requiredReleasePaths,
      forceRefresh,
    );
    if (localPath) {
      return localPath;
    }

    const releaseDir =
      this.options.releaseDir ??
      (await this.options.resolveReleaseDir?.(componentIds, {
        forceRefresh,
      })) ??
      null;
    if (!releaseDir) {
      throw createRemoteAssetPlaceholderError(
        this.options.platformArch ?? "<unknown>",
        this.options,
        componentIds.join(","),
      );
    }
    throw new Error(
      `[deploy] local remote asset not found: ${join(releaseDir, sourceRelativePath)} (component=${componentIds.join(",")})`,
    );
  }

  async installFile(params: {
    componentId: string;
    sourceRelativePath: string;
    remotePath: string;
    executable?: boolean;
    forceRefresh?: boolean;
  }): Promise<void> {
    throwIfRemoteAssetInstallAborted(this.options.signal);
    const localPath = await this.resolveLocalPath(
      [params.componentId],
      params.sourceRelativePath,
      undefined,
      Boolean(params.forceRefresh),
    );
    // 本地解包完成后仍需检查取消，不得让迟到 continuation 再写远端 staging。
    throwIfRemoteAssetInstallAborted(this.options.signal);
    // 多个 Desktop 实例或跨窗口连接可能同时部署到同一 distro/user。
    // 固定 `.new` 会互相覆盖 staging 文件，唯一 owner 路径保证失败清理和最终 rename 不串写。
    const tempRemotePath = `${params.remotePath}.new-${Date.now()}-${randomUUID()}`;
    this.loggers.log(
      `[remote-assets] uploading ${params.sourceRelativePath} to ${params.remotePath}`,
    );
    const remoteParentDir = posix.dirname(params.remotePath);
    const cleanupRemoteStaging = async (): Promise<void> => {
      try {
        const cleanupStream = await this.backend.exec(`rm -f ${quotePosixPathArg(tempRemotePath)}`);
        await waitForClose(cleanupStream);
      } catch (error) {
        this.loggers.logWarn(
          `[remote-assets] failed to clean owned file staging ${tempRemotePath}: ${String(error)}`,
        );
      }
    };

    try {
      const prepareCommands = [
        ...(this.options.signal
          ? [
              buildStaleRemoteStagingCleanupCommand(remoteParentDir, [
                `${posix.basename(params.remotePath)}.new-*`,
              ]),
            ]
          : []),
        `mkdir -p ${quotePosixPathArg(remoteParentDir)}`,
      ];
      const mkdirStream = await this.backend.exec(prepareCommands.join("\n"));
      await waitForClose(mkdirStream);
      await this.backend.upload(localPath, tempRemotePath, {
        signal: this.options.signal,
      });
      throwIfRemoteAssetInstallAborted(this.options.signal);
      await this.verifyUploadedFile(localPath, tempRemotePath);
      const stream = await this.backend.exec(
        params.executable
          ? buildRemoteExecutableReplaceCommand(tempRemotePath, params.remotePath)
          : buildRemoteMoveCommand(tempRemotePath, params.remotePath),
      );
      await waitForClose(stream);
    } catch (error) {
      // 文件替换失败时必须清理当前 owner 的 `.new-*` 文件，否则
      // Docker 非 root 场景会把 chmod 失败的宿主 owner 文件长期留在远端。
      // 取消路径可能已经释放 backend，不能用旧凭据再次 cleanup；由后续 janitor 回收。
      if (!this.options.signal?.aborted) {
        await cleanupRemoteStaging();
      }
      throw error;
    }
  }

  async installDirectory(params: {
    componentId: string;
    sourceRelativePath: string;
    remoteDir: string;
    requiredRelativePaths?: string[];
    forceRefresh?: boolean;
  }): Promise<void> {
    throwIfRemoteAssetInstallAborted(this.options.signal);
    const localPath = await this.resolveLocalPath(
      [params.componentId],
      params.sourceRelativePath,
      buildRequiredReleasePaths(params.sourceRelativePath, params.requiredRelativePaths),
      Boolean(params.forceRefresh),
    );
    const localTarPath = join(
      tmpdir(),
      `zcode-remote-${params.componentId}-${Date.now()}-${randomUUID()}.tar.gz`,
    );
    await createTarGzArchive(localTarPath, [
      { sourcePath: localPath, archivePath: basename(localPath) },
    ]);

    const ownerSuffix = `${Date.now()}-${randomUUID()}`;
    // 目录上传曾复用 `<remoteDir>.tar.gz`，并发部署会互相覆盖压缩包，
    // 甚至把半写文件解压到最终目录。archive/extract 都带 owner，失败时也只清理自己的 staging。
    const remoteTarPath = `${params.remoteDir}.tar.gz-${ownerSuffix}`;
    const remoteExtractDir = `${params.remoteDir}.extract-${ownerSuffix}`;
    const remoteBackupDir = `${params.remoteDir}.backup-${ownerSuffix}`;
    const extractedSourceDir = `${remoteExtractDir}/${basename(localPath)}`;
    const cleanupRemoteStaging = async (): Promise<void> => {
      try {
        const cleanupStream = await this.backend.exec(
          `rm -f ${quotePosixPathArg(remoteTarPath)} && rm -rf ${quotePosixPathArg(remoteExtractDir)}`,
        );
        await waitForClose(cleanupStream);
      } catch (error) {
        this.loggers.logWarn(
          `[remote-assets] failed to clean owned directory staging ${ownerSuffix}: ${String(error)}`,
        );
      }
    };

    try {
      // 本地归档不共享远端生命周期；归档完成后再次检查，禁止取消后创建远端 staging。
      throwIfRemoteAssetInstallAborted(this.options.signal);
      this.loggers.log(
        `[remote-assets] uploading ${params.sourceRelativePath} to ${params.remoteDir}`,
      );
      const remoteParentDir = posix.dirname(params.remoteDir);
      const remoteDirName = posix.basename(params.remoteDir);
      const prepareCommands = [
        ...(this.options.signal
          ? [
              buildStaleRemoteStagingCleanupCommand(remoteParentDir, [
                `${remoteDirName}.tar.gz-*`,
                `${remoteDirName}.extract-*`,
              ]),
            ]
          : []),
        `mkdir -p ${quotePosixPathArg(remoteParentDir)}`,
      ];
      const mkdirStream = await this.backend.exec(prepareCommands.join("\n"));
      await waitForClose(mkdirStream);
      await this.backend.upload(localTarPath, remoteTarPath, {
        signal: this.options.signal,
      });
      throwIfRemoteAssetInstallAborted(this.options.signal);
      await this.verifyUploadedFile(localTarPath, remoteTarPath);
      const stream = await this.backend.exec(
        [
          "set -eu",
          "promoted=0",
          // 先删旧目录再 mv 会在 promotion 失败时丢失可工作的插件；保留本 owner 备份并由 trap 回滚。
          "cleanup_staging() {",
          `  if [ "$promoted" = 0 ] && [ -e ${quotePosixPathArg(remoteBackupDir)} ] && [ ! -e ${quotePosixPathArg(params.remoteDir)} ]; then`,
          `    ${buildRemoteMoveCommand(remoteBackupDir, params.remoteDir)} || echo 'Remote plugin rollback failed; backup retained' >&2`,
          "  fi",
          `  rm -f ${quotePosixPathArg(remoteTarPath)}`,
          `  rm -rf ${quotePosixPathArg(remoteExtractDir)}`,
          `  if [ "$promoted" = 1 ]; then rm -rf ${quotePosixPathArg(remoteBackupDir)}; fi`,
          "}",
          "trap cleanup_staging EXIT",
          "trap 'exit 129' HUP",
          "trap 'exit 130' INT",
          "trap 'exit 143' TERM",
          `rm -rf ${quotePosixPathArg(remoteExtractDir)}`,
          `mkdir -p ${quotePosixPathArg(remoteExtractDir)} ${quotePosixPathArg(posix.dirname(params.remoteDir))}`,
          `tar -xzf ${quotePosixPathArg(remoteTarPath)} -C ${quotePosixPathArg(remoteExtractDir)}`,
          `test -d ${quotePosixPathArg(extractedSourceDir)}`,
          `if [ -e ${quotePosixPathArg(params.remoteDir)} ] || [ -L ${quotePosixPathArg(params.remoteDir)} ]; then ${buildRemoteMoveCommand(params.remoteDir, remoteBackupDir)}; fi`,
          buildRemoteMoveCommand(extractedSourceDir, params.remoteDir),
          "promoted=1",
          "cleanup_staging",
          "trap - EXIT HUP INT TERM",
        ].join("\n"),
      );
      await waitForClose(stream);
    } catch (error) {
      // 连接取消监听会先释放 SSH backend；若随后仍用同一 backend 清理 staging，
      // SSH 实现可能以旧凭据重新连接。取消路径只保留唯一 owner staging，不再触碰正式目录。
      if (!this.options.signal?.aborted) {
        await cleanupRemoteStaging();
      }
      throw error;
    } finally {
      try {
        await rm(localTarPath, { force: true });
      } catch {
        // 忽略临时文件清理失败，部署结果不应受本地清理影响。
      }
    }
  }
}

function buildRequiredReleasePaths(
  sourceRelativePath: string,
  requiredRelativePaths: readonly string[] | undefined,
): string[] {
  const sourcePath = sourceRelativePath.replace(/^\/+|\/+$/gu, "");
  if (!sourcePath) {
    return [];
  }

  const paths = [sourcePath];
  for (const requiredRelativePath of requiredRelativePaths ?? []) {
    const normalizedRequiredPath = requiredRelativePath.replace(/^\/+|\/+$/gu, "");
    if (normalizedRequiredPath) {
      paths.push(posix.join(sourcePath, normalizedRequiredPath));
    }
  }
  return paths;
}

async function findMissingLocalRequiredReleasePaths(
  releaseDir: string,
  requiredReleasePaths: readonly string[] | undefined,
): Promise<string[]> {
  const missingPaths: string[] = [];
  for (const requiredReleasePath of requiredReleasePaths ?? []) {
    const absolutePath = join(releaseDir, requiredReleasePath);
    if (!(await fileExists(absolutePath))) {
      missingPaths.push(absolutePath);
    }
  }
  return missingPaths;
}
