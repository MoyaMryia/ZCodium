import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installLinuxAppImageDesktopIconBestEffort } from "./desktopLinuxAppImageIcon.js";
import {
  runXdgCommand,
  XDG_COMMAND_TIMEOUT_MS,
  type LinuxDesktopCommandRunner,
  type LinuxDeepLinkRegistrationLogger,
} from "./desktopLinuxXdg.js";

// 条目 id 必须与 deb/rpm 安装的系统级条目同名（linuxPackageName），
// 否则"系统级条目已存在就不写用户级"的抑制永远不生效，启动器里会同时出现两个图标。
const DEFAULT_LINUX_DEEP_LINK_DESKTOP_ENTRY_ID = "zcodium";
const LINUX_DEEP_LINK_MIME_TYPE = "x-scheme-handler/zcode";
// 归属标记：用于识别用户级条目是否由本应用写入。改名前的旧标记只用于清理遗留条目。
const LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER = "Comment=ZCodium Desktop App";
const LEGACY_LINUX_DEEP_LINK_DESKTOP_FILE = "zcode.desktop";
const LEGACY_LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER = "Comment=ZCode Desktop App";

type LinuxDesktopEnv = {
  APPIMAGE?: string;
  XDG_DATA_HOME?: string;
  XDG_DATA_DIRS?: string;
};

interface RegisterLinuxDeepLinkProtocolOptions {
  executablePath: string;
  homeDir: string;
  productName?: string;
  /** 桌面条目 id（不含 .desktop），按产品 flavor 取包名；Preview 用独立 id 才不会遮蔽正式版系统条目。 */
  desktopEntryId?: string;
  iconName?: string;
  iconSourcePath?: string;
  env?: LinuxDesktopEnv;
  argv?: string[];
  logger: LinuxDeepLinkRegistrationLogger;
  runCommand?: LinuxDesktopCommandRunner;
  systemApplicationDirs?: string[];
}

interface LinuxDeepLinkCommand {
  executablePath: string;
  args: string[];
}

const APPIMAGE_DEEP_LINK_ARG_NAMES = new Set([
  "--no-sandbox",
  "--disable-gpu",
  "--disable-software-rasterizer",
]);

const APPIMAGE_DEEP_LINK_ARG_PREFIXES = [
  "--use-gl=",
  "--use-angle=",
  "--disable-features=",
  "--enable-features=",
];

function resolveLinuxDeepLinkCommand(params: {
  env?: { APPIMAGE?: string };
  executablePath: string;
  argv?: string[];
}): LinuxDeepLinkCommand {
  const appImagePath = params.env?.APPIMAGE?.trim();
  if (!appImagePath) {
    return { executablePath: params.executablePath, args: [] };
  }

  return {
    executablePath: appImagePath,
    // AppImage 的 zcode:// 回调会由 xdg-open 按 .desktop Exec 二次启动。
    // 用户手动启动时附加的 sandbox/GPU 参数不会自动继承，二次启动可能在 Electron 初始化前崩溃。
    // 这里只持久化影响启动成败的 allowlist 参数，避免把 deep link URL、调试端口或工作区路径写死。
    args: resolveAppImageDeepLinkArgs(params.argv ?? []),
  };
}

function quoteDesktopExecPath(value: string): string {
  return `"${value.replace(/[\\"`$]/g, (match) => `\\${match}`)}"`;
}

function isAllowedAppImageDeepLinkArg(arg: string): boolean {
  return (
    APPIMAGE_DEEP_LINK_ARG_NAMES.has(arg) ||
    APPIMAGE_DEEP_LINK_ARG_PREFIXES.some((prefix) => arg.startsWith(prefix))
  );
}

function resolveAppImageDeepLinkArgs(argv: string[]): string[] {
  const args: string[] = [];
  const seen = new Set<string>();
  for (const arg of argv) {
    if (!isAllowedAppImageDeepLinkArg(arg) || seen.has(arg)) {
      continue;
    }
    seen.add(arg);
    args.push(arg);
  }
  return args;
}

function quoteDesktopExecToken(value: string): string {
  return quoteDesktopExecPath(value);
}

function formatDesktopExec(command: LinuxDeepLinkCommand): string {
  return [command.executablePath, ...command.args]
    .map(quoteDesktopExecToken)
    .concat("%U")
    .join(" ");
}

function createLinuxDeepLinkDesktopEntry(params: {
  executablePath: string;
  args?: string[];
  productName?: string;
  iconName?: string;
}): string {
  const productName = params.productName ?? "ZCodium";
  const iconName = params.iconName ?? "zcodium";
  const command = {
    executablePath: params.executablePath,
    args: params.args ?? [],
  };
  return [
    "[Desktop Entry]",
    `Name=${productName}`,
    LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER,
    `Exec=${formatDesktopExec(command)}`,
    "Terminal=false",
    "Type=Application",
    `Icon=${iconName}`,
    "Categories=Development;",
    `MimeType=${LINUX_DEEP_LINK_MIME_TYPE};`,
    `StartupWMClass=${productName}`,
    "",
  ].join("\n");
}

function resolveLinuxUserDataDir(params: {
  env?: { XDG_DATA_HOME?: string };
  homeDir: string;
}): string {
  const xdgDataHome = params.env?.XDG_DATA_HOME?.trim();
  return xdgDataHome || join(params.homeDir, ".local", "share");
}

function resolveLinuxSystemApplicationDirs(env?: { XDG_DATA_DIRS?: string }): string[] {
  const raw = env?.XDG_DATA_DIRS?.trim();
  const entries = raw
    ? raw
        .split(":")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  // XDG 规范默认值为 /usr/local/share:/usr/share；全部为空的 XDG_DATA_DIRS 也回落默认值。
  const dataDirs = entries.length > 0 ? entries : ["/usr/local/share", "/usr/share"];
  return dataDirs.map((dir) => join(dir, "applications"));
}

function findSystemLevelDesktopEntryPath(
  systemApplicationDirs: string[],
  desktopFileId: string,
): string | undefined {
  for (const dir of systemApplicationDirs) {
    const candidate = join(dir, desktopFileId);
    // 边界：目录或损坏的路径不应被当成有效系统级条目，否则纯 AppImage 用户
    // 的用户级注册会被病态路径误抑制。只有普通文件才参与遮蔽判断。
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // 路径不存在或不可 stat（权限），跳过该候选目录。
    }
  }
  return undefined;
}

function isOwnedDesktopEntry(path: string, ownershipMarker: string): boolean {
  try {
    const content = readFileSync(path, "utf8");
    // 去掉 \r 与行首尾空白，兼容 CRLF 行尾或手工编辑器引入的额外空白，
    // 避免可清理的遗留条目被误判为用户自定义条目而永久残留。
    return content.split("\n").some((line) => line.replaceAll("\r", "").trim() === ownershipMarker);
  } catch {
    return false;
  }
}

function removeOwnedUserDesktopEntry(
  desktopFilePath: string,
  ownershipMarker: string,
  logger: LinuxDeepLinkRegistrationLogger,
): void {
  if (!existsSync(desktopFilePath)) {
    return;
  }
  if (!isOwnedDesktopEntry(desktopFilePath, ownershipMarker)) {
    logger.warn("[deep-link] Linux 用户级 desktop entry 非本应用写入，保留不清理", {
      desktopFilePath,
    });
    return;
  }
  try {
    rmSync(desktopFilePath);
    logger.info("[deep-link] 已清理本应用写入的用户级 desktop entry", {
      desktopFilePath,
    });
  } catch (error) {
    logger.warn("[deep-link] 清理用户级 desktop entry 失败", { desktopFilePath, error });
  }
}

function resolveLinuxDeepLinkDesktopFilePath(dataDir: string, desktopFileId: string): string {
  return join(dataDir, "applications", desktopFileId);
}

function writeFileIfChanged(path: string, content: string): boolean {
  if (existsSync(path) && readFileSync(path, "utf8") === content) {
    return false;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return true;
}

export function registerLinuxDeepLinkProtocol(options: RegisterLinuxDeepLinkProtocolOptions): void {
  const command = resolveLinuxDeepLinkCommand({
    env: options.env,
    executablePath: options.executablePath,
    argv: options.argv,
  });
  const dataDir = resolveLinuxUserDataDir({ env: options.env, homeDir: options.homeDir });
  const desktopFileId = `${options.desktopEntryId ?? DEFAULT_LINUX_DEEP_LINK_DESKTOP_ENTRY_ID}.desktop`;
  const desktopFilePath = resolveLinuxDeepLinkDesktopFilePath(dataDir, desktopFileId);
  const applicationsDir = dirname(desktopFilePath);
  const desktopEntry = createLinuxDeepLinkDesktopEntry({
    ...command,
    productName: options.productName,
    iconName: options.iconName,
  });
  let protocolRegistered = false;
  const runCommand = options.runCommand ?? runXdgCommand;

  // 条目 id 改名前的用户级 zcode.desktop 与新 id 不同名，不会被下面的同名抑制覆盖，
  // 会把 Name=ZCode 的旧图标一直留在启动器里，用户同时看到 ZCode 和 ZCodium 两个入口。
  // 只有带旧归属标记（证明是本应用写的）才删除，用户手写条目保留。
  removeOwnedUserDesktopEntry(
    resolveLinuxDeepLinkDesktopFilePath(dataDir, LEGACY_LINUX_DEEP_LINK_DESKTOP_FILE),
    LEGACY_LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER,
    options.logger,
  );

  // 用户级条目在 XDG 解析中永远优先于系统级同名条目。rpm/deb 安装后，旧 AppImage 写入的
  // 用户级条目会把系统级同名条目持续遮蔽，快捷方式和 zcode:// deep link 一直指向旧 AppImage
  // （文件还在时）或直接失效（文件被删后）。现在只要检测到系统级同 ID 条目：
  // - 系统安装形态（rpm/deb）运行时：清掉本应用写入的遗留用户级条目，且不再写用户级；
  // - AppImage 运行时：不再写用户级条目和用户级图标，避免旧 AppImage 再度遮蔽系统安装。
  // 用户手写的自定义条目（无归属标记）不受影响，保留不清理。
  const systemDesktopEntryPath = findSystemLevelDesktopEntryPath(
    options.systemApplicationDirs ?? resolveLinuxSystemApplicationDirs(options.env),
    desktopFileId,
  );

  try {
    let changed = false;
    if (systemDesktopEntryPath) {
      options.logger.info("[deep-link] Linux 系统级 desktop entry 已存在", {
        systemDesktopEntryPath,
        desktopFilePath,
      });
      removeOwnedUserDesktopEntry(
        desktopFilePath,
        LINUX_DESKTOP_ENTRY_OWNERSHIP_MARKER,
        options.logger,
      );
    } else {
      changed = writeFileIfChanged(desktopFilePath, desktopEntry);
    }
    // AppImage 直跑不会像 deb 安装包一样稳定写入系统 desktop entry。
    // deep link 是 OAuth/支付/工作区打开的核心链路，必须先完成用户级协议处理器刷新；
    // 图标安装是可选增强，放到核心注册成功后独立降级，避免扩大登录回调失败域。
    const updateResult = runCommand("update-desktop-database", [applicationsDir]);
    const defaultResult = runCommand("xdg-mime", [
      "default",
      desktopFileId,
      LINUX_DEEP_LINK_MIME_TYPE,
    ]);

    if (defaultResult.status === 0) {
      protocolRegistered = true;
      options.logger.info("[deep-link] Linux 用户级协议注册成功", {
        desktopFilePath,
        executablePath: command.executablePath,
        args: command.args,
        changed,
        systemDesktopEntryPath,
      });
    } else {
      options.logger.warn("[deep-link] Linux 用户级协议注册失败", {
        desktopFilePath,
        executablePath: command.executablePath,
        args: command.args,
        status: defaultResult.status,
        signal: defaultResult.signal,
        timeoutMs: defaultResult.signal === "SIGTERM" ? XDG_COMMAND_TIMEOUT_MS : undefined,
        error: defaultResult.error?.message,
        stderr: defaultResult.stderr?.trim(),
      });
    }

    if (updateResult.error) {
      options.logger.warn("[deep-link] update-desktop-database 不可用，已跳过", {
        desktopFilePath,
        message: updateResult.error.message,
      });
    } else if (updateResult.signal === "SIGTERM") {
      options.logger.warn("[deep-link] update-desktop-database 超时，已跳过", {
        desktopFilePath,
        timeoutMs: XDG_COMMAND_TIMEOUT_MS,
      });
    } else if (updateResult.status !== 0) {
      options.logger.warn("[deep-link] update-desktop-database 失败，已跳过", {
        desktopFilePath,
        status: updateResult.status,
        signal: updateResult.signal,
        stderr: updateResult.stderr?.trim(),
      });
    }
  } catch (error) {
    options.logger.warn("[deep-link] Linux 用户级协议注册异常", {
      desktopFilePath,
      executablePath: command.executablePath,
      args: command.args,
      error,
    });
  }

  const iconInstallResult = systemDesktopEntryPath
    ? null
    : installLinuxAppImageDesktopIconBestEffort({
        dataDir,
        env: options.env,
        iconSourcePath: options.iconSourcePath,
        logger: options.logger,
        runCommand,
      });
  if (iconInstallResult) {
    options.logger.info("[deep-link] Linux AppImage 用户级图标安装完成", {
      protocolRegistered,
      iconFilePath: iconInstallResult.iconFilePath,
      iconInstalled: iconInstallResult.installed,
      iconChanged: iconInstallResult.changed,
    });
  }
}
