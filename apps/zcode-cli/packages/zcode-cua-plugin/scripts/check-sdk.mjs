/**
 * SDK 冒烟检查。
 *
 * 两件事都做：文件在不在，以及能不能真的 import。后者是必要的——文件存在但语法
 * 错误，前者查不出来，而那种包装出来是一个看得见 computer-use 却调不到任何方法的
 * 残缺插件。
 */

import { access } from "node:fs/promises";
import { resolve } from "node:path";

const MODULES = [
  "computer-use-client.mjs",
  "computer-use-errors.mjs",
  "computer-use-envelope.mjs",
  "computer-use-keys.mjs",
  "computer-use-target.mjs",
];

for (const name of MODULES) {
  await access(resolve(import.meta.dirname, name));
}

// 顶层只导出常量与工厂，import 不会有副作用，所以这里安全。
await import("./computer-use-client.mjs");
