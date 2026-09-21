/**
 * 让 `node --test` 在没装 tsx 的 checkout 里也能跑。
 *
 * 仓库源码遵循 NodeNext 约定：import 写 `.js` 后缀，实际文件是 `.ts`。
 * 这个约定要 tsx / tsc 来解析；Node 原生的 type stripping 不做这层重写。
 * 这里补一个同步 resolve hook：相对导入的 `.js` 若不存在而 `.ts` 存在，就改指 `.ts`。
 *
 * 只影响本工具的测试运行，不进 src、不进产物。
 */

import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      specifier.endsWith(".js")
    ) {
      try {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      } catch {
        // .ts 也不存在：按原样交给下一个 resolver，让错误照实报出来
      }
    }
    return nextResolve(specifier, context);
  },
});
