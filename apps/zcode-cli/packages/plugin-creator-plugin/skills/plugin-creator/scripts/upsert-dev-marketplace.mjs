import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { normalizePluginName } from "./create-basic-plugin.mjs";
import {
  atomicJson,
  exists,
  marketplacePlan,
  rejectSymlink,
  withMarketplaceLock,
} from "./marketplace-files.mjs";
import { preflightPlugin } from "./validate-plugin.mjs";

/**
 * 开发市场的名字。
 *
 * 由目录名 + 规范路径的短哈希拼成：同一个 workspace 每次得到同一个名字（用户第二次
 * 跑不会看到市场名变了），不同 workspace 不会撞名。Windows 上路径大小写不敏感，
 * 所以先小写再哈希，否则同一个目录两种写法会算出两个市场。
 */
function devMarketplaceName(root) {
  const directory = basename(root) === "plugins" ? basename(dirname(root)) : basename(root);
  const label =
    directory
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 48) || "workspace";
  const identity = process.platform === "win32" ? root.toLowerCase() : root;
  return `dev-${label}-${createHash("sha256").update(identity).digest("hex").slice(0, 8)}`;
}

/**
 * 把插件登记进本地开发市场。
 *
 * **只动开发目录里的清单文件。** 安装状态始终由 CLI/宿主管理：这里不写用户源码、
 * 不写安装缓存、不注册市场。越界去做那些事会让「本地试一下」变成一次静默的全局变更。
 */
export async function upsertDevMarketplace({
  pluginPath,
  marketplacePath,
  displayName,
  nameZh,
  descriptionZh,
}) {
  await rejectSymlink(resolve(pluginPath));
  const pluginRoot = await realpath(pluginPath);

  const errors = await preflightPlugin(pluginRoot);
  if (errors.length) throw new Error(errors.join("\n"));

  const manifest = JSON.parse(
    await readFile(join(pluginRoot, ".zcode-plugin", "plugin.json"), "utf8"),
  );
  const name = normalizePluginName(manifest.name);
  // 目录名、manifest 名、规范化名三者必须一致：manifest 名是条目的稳定 ID，
  // 三者不一致时用户装到的会是一个名字对不上的插件。
  if (name !== manifest.name || name !== basename(pluginRoot)) {
    throw new Error("Plugin directory and manifest name must match");
  }
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("A plugin version is required for dev updates");
  }

  const requestedPath = marketplacePath
    ? resolve(marketplacePath)
    : join(dirname(pluginRoot), "marketplace.json");
  const root = basename(dirname(requestedPath)) === ".claude-plugin"
    ? dirname(dirname(requestedPath))
    : dirname(requestedPath);
  await rejectSymlink(root);
  await rejectSymlink(dirname(requestedPath));
  await rejectSymlink(requestedPath);
  if (!(await exists(root))) {
    throw new Error("Marketplace root is missing or outside the plugin parent");
  }

  // macOS 的 /var 与 /private/var 等系统路径别名必须先统一，否则同一目录两种写法
  // 会让「来源是否在市场内」误判成越界。
  const canonicalRoot = await realpath(root);
  const path = join(canonicalRoot, relative(root, requestedPath));

  // 先算一次计划：这一步就要发现来源冲突、条目冲突，避免给一个越界目标创建锁文件
  // 或父目录。
  await marketplacePlan(path, pluginRoot, name, true, true);

  const defaultName = devMarketplaceName(canonicalRoot);
  return withMarketplaceLock(path, async () => {
    const previous = (await exists(path)) ? JSON.parse(await readFile(path, "utf8")) : undefined;
    // 没显式指定市场文件时， refuse 接管一个不是本机生成的市场：那份清单可能是用户
    // 手工维护的，改名或改条目都会破坏他的整理。
    if (!marketplacePath && previous && previous.name !== defaultName) {
      throw new Error(
        "Existing marketplace is not this development market; pass --marketplace-path explicitly to reuse it",
      );
    }

    const market = await marketplacePlan(path, pluginRoot, name, true, true);
    if (!previous) market.name = defaultName;

    const entry = market.plugins.find((item) => item.name === name);
    // 版本与描述跟着 manifest 走，展示名与本地化标题保留用户已填的值。
    Object.assign(entry, { version: manifest.version, description: manifest.description ?? "" });
    entry.displayName = displayName ?? entry.displayName ?? name;
    if (nameZh) entry.displayName_i18n = { ...entry.displayName_i18n, "zh-CN": nameZh };
    if (descriptionZh) {
      entry.description_i18n = { ...entry.description_i18n, "zh-CN": descriptionZh };
    }

    // 没变就不写：写文件会改 mtime，而市场刷新是按文件变化判断要不要重新读的。
    const changed = JSON.stringify(previous) !== JSON.stringify(market);
    if (changed) await atomicJson(path, market);

    return {
      marketplaceId: market.name,
      marketplaceRoot: canonicalRoot,
      marketplacePath: path,
      pluginId: `${name}@${market.name}`,
      pluginPath: pluginRoot,
      version: manifest.version,
      changed,
    };
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "marketplace-path": { type: "string" },
      "display-name": { type: "string" },
      "name-zh": { type: "string" },
      "description-zh": { type: "string" },
    },
  });
  if (positionals.length !== 1) {
    throw new Error(
      "Usage: node upsert-dev-marketplace.mjs <plugin-path> [--marketplace-path file] [--display-name name] [--name-zh name] [--description-zh text]",
    );
  }
  const result = await upsertDevMarketplace({
    pluginPath: positionals[0],
    marketplacePath: values["marketplace-path"],
    displayName: values["display-name"],
    nameZh: values["name-zh"],
    descriptionZh: values["description-zh"],
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
