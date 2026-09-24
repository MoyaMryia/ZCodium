import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Remote JS and native addon must come from the same pinned platform package. */
export function createRemotePtyBuildPlugin(root = resolve(import.meta.dirname, "..")) {
  const require = createRequire(join(root, "packages/server/package.json"));
  const entry = require.resolve("@lydell/node-pty-linux-x64");
  const packageRoot = dirname(dirname(entry));
  return {
    name: "remote-pty-runtime",
    setup(builder) {
      // Server 原先内联 node-pty 1.1，却部署 1.2 beta 的 addon，resize 参数不兼容。
      // 此解析规则只用于远端 bundle，桌面 Electron 的 PTY 仍由桌面构建管理。
      builder.onResolve({ filter: /^node-pty(?:\/|$)/ }, ({ path }) => ({
        path:
          path === "node-pty"
            ? entry
            : require.resolve(join(packageRoot, path.slice("node-pty/".length))),
      }));
      builder.onLoad(
        { filter: /[/\\]node-pty-linux-x64[/\\]lib[/\\]index\.js$/ },
        async ({ path }) => ({
          // 平台裁剪包没有 windowsTerminal；仅对这个依赖入口固定其真实目标平台。
          contents: (await readFile(path, "utf8")).replaceAll("process.platform", '"linux"'),
          loader: "js",
        }),
      );
    },
  };
}
