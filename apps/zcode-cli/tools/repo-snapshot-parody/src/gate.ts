/**
 * 启用开关。
 *
 * 刻意只认命令行 flag 与环境变量：任何应用自己写得动的持久化路径（setting.json /
 * config.json）都不算数——那等于把拒绝权交回给应用。原版的问题不只是传了什么，
 * 更是用户没有任何拒绝的入口，所以这里连"关"的入口都不放在应用手里。
 */

export const PARODY_ENV_KEY = "ZCODE_PARODY_SNAPSHOT" as const;
export const PARODY_FLAG = "--parody-snapshot" as const;

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** 只认显式真值。空串、`0`、`false`、拼写错误一律视为未启用，不猜。 */
export function isTruthyFlagValue(value: string | undefined): boolean {
  if (typeof value !== "string") return false;
  return TRUTHY.has(value.trim().toLowerCase());
}

export interface ParodyGateInput {
  readonly argv?: readonly string[];
  readonly env?: Record<string, string | undefined>;
}

export interface ParodyGateResult {
  readonly enabled: boolean;
  /** 启用来源，用于日志里说清"是谁开的"。 */
  readonly source: "flag" | "env" | "none";
  readonly reason?: string;
}

export function resolveParodyGate(input: ParodyGateInput = {}): ParodyGateResult {
  const argv = input.argv ?? process.argv.slice(2);
  const env = input.env ?? process.env;

  if (argv.includes(PARODY_FLAG)) {
    return { enabled: true, source: "flag" };
  }
  if (isTruthyFlagValue(env[PARODY_ENV_KEY])) {
    return { enabled: true, source: "env" };
  }
  return {
    enabled: false,
    source: "none",
    reason:
      `未启用。本工具默认完全静默：不扫描、不打包、不写出任何文件。\n` +
      `显式启用（二选一）：\n` +
      `  ${PARODY_FLAG}\n` +
      `  ${PARODY_ENV_KEY}=1\n` +
      `开关只接受命令行与环境变量；setting.json 之类的持久化配置一律不读——\n` +
      `那正是原版让人无法拒绝的那条路。`,
  };
}

/** 回环判定。默认只允许本机，避免这个工具被指到远端。 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/gu, "");
  return LOOPBACK_HOSTS.has(normalized) || /^127\.\d+\.\d+\.\d+$/u.test(normalized);
}

export function assertLoopbackTarget(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`目标不是合法 URL：${rawUrl}`);
  }
  if (!isLoopbackHost(parsed.hostname)) {
    throw new Error(
      `拒绝非回环目标：${parsed.hostname}。本工具只往 127.0.0.1 传，` +
        `往别处传就不是自嘲是外泄了。`,
    );
  }
  return parsed;
}
