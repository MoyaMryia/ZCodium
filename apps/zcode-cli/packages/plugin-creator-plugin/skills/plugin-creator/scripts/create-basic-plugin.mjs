import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { scaffoldFiles } from "./scaffold-files.mjs";
import {
  atomicJson,
  exists,
  marketplacePlan,
  rejectSymlink,
  withMarketplaceLock,
} from "./marketplace-files.mjs";

/** 脚手架认识的组件。新增组件要同时改这里和 scaffold-files.mjs 的产出表。 */
const COMPONENTS = ["skills", "commands", "mcp", "hooks", "scripts", "assets"];

/**
 * 规范插件名。
 *
 * 目录名与 manifest 名必须一致，而 manifest 名会进市场条目的 ID，所以这里做一次强规范：
 * 只留小写字母数字，其余折叠成连字符。带路径分隔符的直接拒——那说明调用方想用名字
 * 指定位置，而位置是 `--path` 的职责。
 */
export function normalizePluginName(input) {
  if (/[\\/]/u.test(input)) throw new Error("Plugin name must not contain path separators");
  const name = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!name || name.length > 64) {
    throw new Error("Plugin name must contain 1–64 ASCII letters/digits/hyphens");
  }
  return name;
}

/**
 * 逐个检查待写文件的目标路径。
 *
 * 从 root 一路查到目标文件，每一步都拒绝符号链接：只查最终路径不够，中间某一级是链接
 * 就能把写入引到插件外面去。force 时才允许覆盖已存在的文件。
 */
async function checkDestination(root, path, force) {
  let current = path;
  while (current !== dirname(root)) {
    await rejectSymlink(current);
    if (current === root) break;
    current = dirname(current);
  }
  if (!force && (await exists(path))) throw new Error(`File already exists: ${path}`);
}

/**
 * 创建插件。
 *
 * 顺序是刻意的：**所有校验都在动笔之前完成**。市场冲突、目标已存在、符号链接这三类
 * 问题都在写第一个文件前发现，否则会留下一份半成品 scaffold，而用户得自己判断哪些文件
 * 是新的、哪些是旧的。
 */
export async function createPlugin({
  name: rawName,
  parentPath = resolve("plugins"),
  marketplacePath,
  components = [],
  force = false,
}) {
  const name = normalizePluginName(rawName);
  if (components.some((component) => !COMPONENTS.includes(component))) {
    throw new Error("Unsupported component");
  }
  const root = resolve(parentPath, name);
  const marketPath = marketplacePath ? resolve(marketplacePath) : undefined;

  if (marketPath) await marketplacePlan(marketPath, root, name, force);
  await rejectSymlink(root);
  if (!force && (await exists(root))) throw new Error(`Plugin directory already exists: ${root}`);

  const files = scaffoldFiles(name, components);
  for (const file of files.keys()) await checkDestination(root, join(root, file), force);

  await mkdir(root, { recursive: true });
  for (const [file, contents] of files) {
    const destination = join(root, file);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, { flag: force ? "w" : "wx" });
  }

  // 锁内重算一次计划：上面那次只是预检，真正落盘要基于锁内的最新内容，
  // 否则两个并发创建会互相覆盖对方刚加的条目。
  if (marketPath) {
    await withMarketplaceLock(marketPath, async () =>
      atomicJson(marketPath, await marketplacePlan(marketPath, root, name, force)),
    );
  }
  return root;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      path: { type: "string" },
      "marketplace-path": { type: "string" },
      force: { type: "boolean", default: false },
      ...Object.fromEntries(
        COMPONENTS.map((component) => [`with-${component}`, { type: "boolean", default: false }]),
      ),
    },
  });
  if (positionals.length !== 1) {
    throw new Error(
      "Usage: node create-basic-plugin.mjs <name> [--path parent] [--with-skills] [--with-mcp] [--with-hooks] [--marketplace-path file] [--force]",
    );
  }
  const root = await createPlugin({
    name: positionals[0],
    parentPath: values.path,
    marketplacePath: values["marketplace-path"],
    force: values.force,
    components: COMPONENTS.filter((component) => values[`with-${component}`]),
  });
  console.log(
    `Created ${root}. Customize the scaffold, then run zcode plugins validate before installation.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
