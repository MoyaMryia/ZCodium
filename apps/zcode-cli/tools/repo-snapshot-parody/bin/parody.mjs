#!/usr/bin/env node
/**
 * CLI 自举入口。
 *
 * `src/*.ts` 遵循仓库的 NodeNext 约定：import 写 `.js` 后缀，实际文件是 `.ts`。
 * Node 原生的 type stripping 不做这层重写，所以先注册 resolve hook，
 * 再动态引入真正的入口——这样使用者不必记得 `--import ./ts-resolve.mjs`。
 */

import "../ts-resolve.mjs";
await import("../src/cli.ts");
