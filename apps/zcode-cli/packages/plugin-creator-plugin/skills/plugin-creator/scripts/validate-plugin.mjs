import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

import { escapesRoot } from "./marketplace-files.mjs";

/** 模板里留给用户填的占位符。留着它们就发布出去等于发布一个不能用的插件。 */
const PLACEHOLDER = /\bTODO\b|\bFIXME\b|<your[-_ ][^>]+>|YOUR_API_KEY/u;
/** 运行时由 loader 替换的根目录令牌。 */
const ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}/";

/** manifest 里可以指向目录或文件的字段。 */
const RESOURCE_FIELDS = ["skills", "commands", "hooks", "mcpServers"];

/** 会被当作文本检查的扩展名。二进制资源（图片等）跳过，扫了也没意义。 */
const TEXT_EXTENSION = /\.(?:json|md|mjs|cjs|js|ts|txt|yaml|yml|toml)$/u;

/**
 * 走一遍 manifest 声明的全部资源，返回错误列表（空数组 = 通过）。
 *
 * 这是**附加**完整性检查，不复制 ZCode 的 manifest schema——真正的 schema 校验由
 * `zcode plugins validate` 做。这里补它不查的两类问题：
 *   1. 资源是否真的存在、是否逃出插件目录（符号链接）
 *   2. 是否留着未填的占位符
 */
export async function preflightPlugin(path) {
  const root = await realpath(path);
  const errors = [];
  const resources = [];

  const manifestPath = await realpath(join(root, ".zcode-plugin", "plugin.json"));
  if (escapesRoot(root, manifestPath)) return ["Manifest symlink escapes outside plugin"];
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  /**
   * 递归扫 manifest 的每个字符串值。
   *
   * 两件事：抓占位符，以及收集写了 `${CLAUDE_PLUGIN_ROOT}/xxx` 的资源路径——那种
   * 相对写法指向的也是插件内资源，同样要验证存在。
   */
  function inspect(value) {
    if (typeof value === "string") {
      if (PLACEHOLDER.test(value)) errors.push("Unresolved TODO/placeholder");
      const offset = value.indexOf(ROOT_TOKEN);
      if (offset >= 0) resources.push(value.slice(offset + ROOT_TOKEN.length).split(/["'\s]/u)[0]);
    } else if (Array.isArray(value)) {
      value.forEach(inspect);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(inspect);
    }
  }
  inspect(manifest);

  for (const field of RESOURCE_FIELDS) {
    const value = manifest[field];
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry === "string") resources.push(entry);
    }
  }

  // 两套去重：一套按用户写的字符串，一套按 realpath 后的真实位置。
  // 后者防的是同一个文件被两条不同相对路径指向时重复检查。
  const visited = new Set();
  const visitedActual = new Set();
  while (resources.length) {
    const resource = resources.shift();
    if (visited.has(resource)) continue;
    visited.add(resource);

    const candidate = resolve(root, resource);
    if (escapesRoot(root, candidate)) {
      errors.push(`Resource escapes outside plugin: ${resource}`);
      continue;
    }
    try {
      const actual = await realpath(candidate);
      if (escapesRoot(root, actual)) {
        errors.push(`Resource symlink escapes outside plugin: ${resource}`);
        continue;
      }
      if (visitedActual.has(actual)) continue;
      visitedActual.add(actual);

      const info = await stat(actual);
      if (info.isDirectory()) {
        // 目录要展开，但 node_modules 与 .git 不进插件产物，扫它们只会拖慢且误报。
        for (const entry of await readdir(actual)) {
          if (entry !== "node_modules" && entry !== ".git") {
            resources.push(join(resource, entry));
          }
        }
      } else if (info.isFile() && TEXT_EXTENSION.test(actual)) {
        const text = await readFile(actual, "utf8");
        if (actual.endsWith(".json")) inspect(JSON.parse(text));
        else if (PLACEHOLDER.test(text)) errors.push(`Unresolved placeholder: ${resource}`);
      }
    } catch (error) {
      errors.push(`Resource unavailable: ${resource}: ${error.message}`);
    }
  }
  return errors;
}

/**
 * 跑真正的 schema 校验。
 *
 * `cli` 可以是可执行名也可以是 JS 入口：后者要用当前 node 跑，因为.js 文件不可执行。
 * Windows 上拒绝 `.cmd`——不走 shell 的 spawn 补不上 PATHEXT，而带 shell spawn `.cmd`
 * 又被 Node 的安全策略禁掉，两条路都堵死，所以明确要求 `.exe` 或 JS 入口。
 */
export async function validatePlugin(path, cli = "zcode") {
  const errors = await preflightPlugin(path);
  if (errors.length) throw new Error(errors.join("\n"));

  const nodeEntry = /\.[cm]?js$/u.test(cli);
  if (process.platform === "win32" && /\.cmd$/iu.test(cli)) {
    throw new Error("Use --cli with zcode.exe or the CLI JavaScript entrypoint on Windows");
  }
  const args = [...(nodeEntry ? [cli] : []), "plugins", "validate", resolve(path)];
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(nodeEntry ? process.execPath : cli, args, {
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("close", (code) => accept(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`ZCode plugin validation failed (${exitCode})`);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { cli: { type: "string" } },
  });
  if (positionals.length !== 1) {
    throw new Error(
      "Usage: node validate-plugin.mjs <plugin-path> [--cli zcode-executable-or-js-entry]",
    );
  }
  await validatePlugin(positionals[0], values.cli);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
