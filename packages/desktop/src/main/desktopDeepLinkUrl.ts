const DEEP_LINK_SCHEME = "zcode";
const DEEP_LINK_RE = /\bzcode:(?:\/\/|\/)?[^\s"'<>]+/i;
const WORKSPACE_OPEN_HOST = "workspace";
const DEEP_LINK_ADDITIONAL_DATA_KEY = "deepLinkUrl";
const OPEN_WORKSPACE_ADDITIONAL_DATA_KEY = "openWorkspacePath";
const OPEN_WORKSPACE_ARG = "--open-workspace";

function normalizeDeepLinkPath(pathname: string): string {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  const normalized = withoutTrailingSlash === "" ? "/" : withoutTrailingSlash;
  return `/${normalized.replace(/^\/+/, "")}`;
}

export function isWorkspaceOpenUrl(parsedUrl: URL): boolean {
  if (parsedUrl.protocol !== `${DEEP_LINK_SCHEME}:`) {
    return false;
  }

  const normalizedPath = normalizeDeepLinkPath(parsedUrl.pathname);
  if (parsedUrl.hostname === WORKSPACE_OPEN_HOST) {
    return normalizedPath === "/open";
  }

  if (parsedUrl.hostname) {
    return false;
  }

  const [, host, ...pathParts] = normalizedPath.split("/");
  return Boolean(host === WORKSPACE_OPEN_HOST && `/${pathParts.join("/")}` === "/open");
}

export function extractWorkspaceOpenPath(parsedUrl: URL): string | null {
  if (!isWorkspaceOpenUrl(parsedUrl)) {
    return null;
  }

  const path = parsedUrl.searchParams.get("path");
  return path && path.length > 0 ? path : null;
}

function decodeDeepLinkCandidate(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value ? null : decoded;
  } catch {
    return null;
  }
}

function expandDecodedDeepLinkCandidates(value: string): string[] {
  const candidates = [value];
  let current = value;

  for (let index = 0; index < 3; index++) {
    const decoded = decodeDeepLinkCandidate(current);
    if (!decoded || candidates.includes(decoded)) {
      break;
    }

    candidates.push(decoded);
    current = decoded;
  }

  return candidates;
}

function buildArgCandidates(args: readonly string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (value: string) => {
    if (!seen.has(value)) {
      candidates.push(value);
      seen.add(value);
    }
  };

  for (const arg of args) {
    addCandidate(arg);
  }

  for (let start = 0; start < args.length; start++) {
    let joined = "";
    for (let end = start; end < Math.min(args.length, start + 5); end++) {
      joined += args[end] ?? "";
      if (end > start) {
        addCandidate(joined);
      }
    }
  }

  return candidates;
}

function extractFromCandidate(value: string): string | null {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  const match = trimmed.match(DEEP_LINK_RE);
  const url = match?.[0].replace(/&amp;/gi, "&").replace(/\\([&=?:/])/g, "$1");
  if (!url) return null;
  try {
    // 单实例转发只接收工作区入口，避免把旧登录凭据再次传给主进程。
    return isWorkspaceOpenUrl(new URL(url)) ? url : null;
  } catch {
    return null;
  }
}

function isCompleteDeepLinkUrl(value: string): boolean {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    return false;
  }

  return isWorkspaceOpenUrl(parsedUrl) && parsedUrl.searchParams.has("path");
}

export function extractDeepLinkUrlFromArgs(args: readonly string[]): string | null {
  let fallbackMatch: string | null = null;

  for (const arg of buildArgCandidates(args)) {
    for (const candidate of expandDecodedDeepLinkCandidates(arg)) {
      const match = extractFromCandidate(candidate);
      if (match) {
        // Debian/xdg 的工作区链接可能被浏览器或桌面门户多次编码，
        // 也可能把 query 片段拆成相邻 argv。这里先生成有限候选再多轮解码，
        // 避免浏览器确认“打开 ZCode”后主进程拿不到完整工作区 URL。
        if (isCompleteDeepLinkUrl(match)) {
          return match;
        }
        fallbackMatch ??= match;
      }
    }
  }

  return fallbackMatch;
}

function trimArgValue(value: string): string {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "'") && first === last) {
    return trimmed.slice(1, -1);
  }

  if (/^[A-Za-z]:(?:\\.*)?["']$/.test(trimmed)) {
    // Windows Explorer 的 Drive\shell 菜单会把 C:\ 代入 "%1"。
    // 部分 argv 解析链会把末尾反斜杠和闭合引号折叠成尾引号，这里只修正盘符绝对路径。
    return `${trimmed.slice(0, -1)}\\`;
  }

  return trimmed;
}

export function extractOpenWorkspacePathFromArgs(args: readonly string[]): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === OPEN_WORKSPACE_ARG) {
      const value = args[index + 1];
      const path = value ? trimArgValue(value) : "";
      if (path) {
        return path;
      }
      continue;
    }

    if (arg.startsWith(`${OPEN_WORKSPACE_ARG}=`)) {
      const path = trimArgValue(arg.slice(OPEN_WORKSPACE_ARG.length + 1));
      if (path) {
        return path;
      }
    }
  }

  return null;
}

export function createDeepLinkSingleInstanceData(args: readonly string[]): Record<string, string> {
  const url = extractDeepLinkUrlFromArgs(args);
  const openWorkspacePath = extractOpenWorkspacePathFromArgs(args);
  return {
    ...(url ? { [DEEP_LINK_ADDITIONAL_DATA_KEY]: url } : {}),
    ...(openWorkspacePath ? { [OPEN_WORKSPACE_ADDITIONAL_DATA_KEY]: openWorkspacePath } : {}),
  };
}

export function extractDeepLinkUrlFromSingleInstanceData(additionalData: unknown): string | null {
  if (!additionalData || typeof additionalData !== "object") {
    return null;
  }

  const value = (additionalData as Record<string, unknown>)[DEEP_LINK_ADDITIONAL_DATA_KEY];
  if (typeof value !== "string") {
    return null;
  }

  return extractDeepLinkUrlFromArgs([value]);
}

export function extractOpenWorkspacePathFromSingleInstanceData(
  additionalData: unknown,
): string | null {
  if (!additionalData || typeof additionalData !== "object") {
    return null;
  }

  const value = (additionalData as Record<string, unknown>)[OPEN_WORKSPACE_ADDITIONAL_DATA_KEY];
  if (typeof value !== "string") {
    return null;
  }

  return extractOpenWorkspacePathFromArgs([`${OPEN_WORKSPACE_ARG}=${value}`]);
}
