import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * 本地开发市场清单的安全读写。
 *
 * 这个模块只做四件事：判断路径是否逃出市场根、原子写 JSON、算出市场条目该长什么样、
 * 以及给整个「读-改-写」加一把文件锁。四件事都必须做，因为市场清单是用户手也能编辑的
 * 共享文件：并发写会互相覆盖，符号链接会让写入落到市场外面去。
 */

/** 路径存在与否。只用 lstat，不跟随符号链接——「存在一个链接」不等于「存在一个文件」。 */
export async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 拒绝符号链接。
 *
 * 不存在时放过（调用方随后会创建它），是符号链接就抛。对所有祖先进路径都要调一次：
 * 词法路径合法仍可能整个链中间某一段是链接。
 */
export async function rejectSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${path}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** `path` 是否落在 `root` 之外。 */
export function escapesRoot(root, path) {
  const value = relative(root, path);
  return value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value);
}

/**
 * 原子写 JSON。
 *
 * 先独占创建临时文件再 rename：读者只会看到旧内容或新内容，不会看到写了一半的。
 * 临时名带 pid，所以并发写入者各写各的；`wx` 抢不到就抛，不会覆盖别人的。
 */
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  // 独占创建成功后才接管清理，避免失败时删掉其他写入者的文件。
  const handle = await open(temporary, "wx");
  try {
    try {
      await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * 市场根目录。
 *
 * `<root>/.claude-plugin/marketplace.json` 与 `<root>/marketplace.json` 都合法，而且
 * 前者的根是 `.claude-plugin` 的**父目录**——插件源路径相对它解析，不是相对清单自己
 * 所在目录。认错这一层会让所有 source 都偏移一级。
 */
function marketplaceRootOf(manifestPath) {
  return basename(dirname(manifestPath)) === ".claude-plugin"
    ? dirname(dirname(manifestPath))
    : dirname(manifestPath);
}

/**
 * 算出写入后的市场清单内容，但不落盘。
 *
 * 拆成纯函数是为了让调用方能先拿到计划再决定要不要写——创建插件的流程需要在写出任何
 * 文件之前就发现市场冲突，否则会留下半份 scaffold。
 *
 * @param {string} path 市场清单文件路径
 * @param {string} pluginRoot 插件源目录（绝对路径）
 * @param {string} name 插件名
 * @param {boolean} force 允许覆盖同名条目
 * @param {boolean} requireSameSource 同名但来源不同时报错而非替换
 */
export async function marketplacePlan(path, pluginRoot, name, force, requireSameSource = false) {
  const root = marketplaceRootOf(path);
  await rejectSymlink(root);
  await rejectSymlink(path);

  const sourcePath = relative(root, pluginRoot);
  if (
    !sourcePath ||
    sourcePath === ".." ||
    sourcePath.startsWith(`..${sep}`) ||
    isAbsolute(sourcePath)
  ) {
    throw new Error("Plugin source is outside the marketplace root");
  }
  // 词法路径合法仍可能经过符号链接逃出市场，所以沿祖先链逐个查。
  let parent = pluginRoot;
  while (parent !== root) {
    await rejectSymlink(parent);
    parent = dirname(parent);
  }

  const value = (await exists(path))
    ? JSON.parse(await readFile(path, "utf8"))
    : { name: "personal", plugins: [] };
  // 结构不合法的清单不猜、不补：静默重建会把用户已有的其他条目清空。
  if (
    !value ||
    typeof value !== "object" ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(value.name ?? "") ||
    !Array.isArray(value.plugins)
  ) {
    throw new Error("Invalid marketplace name or plugins array; validate the existing file first");
  }

  const seen = new Set();
  for (const entry of value.plugins) {
    if (!entry || typeof entry.name !== "string") throw new Error("Invalid marketplace entry");
    if (seen.has(entry.name)) throw new Error(`Duplicate marketplace entry: ${entry.name}`);
    seen.add(entry.name);
  }

  const index = value.plugins.findIndex((entry) => entry.name === name);
  if (index !== -1 && !force) throw new Error(`Marketplace entry already exists: ${name}`);
  const previous = index === -1 ? {} : value.plugins[index];
  if (
    index !== -1 &&
    requireSameSource &&
    (typeof previous.source !== "string" || resolve(root, previous.source) !== pluginRoot)
  ) {
    // 同名但指向别处：这是「两个不同的插件用了同一个名字」，替换会让其中一个消失。
    throw new Error(`Marketplace source conflict: ${name}`);
  }

  // 只改自己那一条，其余条目、顺序、市场名全部原样保留。
  const entry = { ...previous, name, source: `./${sourcePath.split(sep).join("/")}` };
  if (index === -1) value.plugins.push(entry);
  else value.plugins[index] = entry;
  return value;
}

/**
 * 文件锁包住整个「读-改-写」。
 *
 * 锁文件用 `wx` 独占创建：抢到才继续，抢不到说明有另一个进程正在改同一份清单，
 * 此时必须失败而不是两个人都基于旧内容写。无论成败都不留下锁文件。
 */
export async function withMarketplaceLock(path, operation) {
  await rejectSymlink(dirname(path));
  await rejectSymlink(path);
  await mkdir(dirname(path), { recursive: true });
  const lockPath = path + ".lock";
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Marketplace is busy: " + lockPath);
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
