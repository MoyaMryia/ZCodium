import { rm } from "node:fs/promises";

// 删除功能后，增量 tsc 不会清理旧模块；先清空产物，避免打包已移除的抓包实现。
await Promise.all(
  ["../dist/", "../dist-server/"].map((path) =>
    rm(new URL(path, import.meta.url), { recursive: true, force: true }),
  ),
);
