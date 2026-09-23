import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 更新源归属是发布安全属性，不是实现细节：上游 manifest 分发的是官方 ZCode 安装包
// （appId dev.zcode.app），ZCodium 是 dev.zcodium.app。一旦更新源退回上游，用户点更新
// 会把自己的客户端覆盖成上游版本。这里用源码级断言把该属性固定在 CI 里。
// 详见 .agents/specs/update-source-ownership.md。
const root = fileURLToPath(new URL("../../", import.meta.url));

const UPDATE_PATH_SOURCES = [
  "packages/desktop/src/main/autoUpdater.ts",
  "packages/desktop/src/main/forceUpdateGuard.ts",
  "packages/desktop/src/main/index.ts",
];

test("自动更新与强制升级门禁以自有更新源为准，缺失时跳过而非回退上游", async () => {
  const autoUpdater = await readFile(
    join(root, "packages/desktop/src/main/autoUpdater.ts"),
    "utf8",
  );
  const guard = await readFile(join(root, "packages/desktop/src/main/forceUpdateGuard.ts"), "utf8");

  // autoUpdater 必须在未配置时提前返回，不能把上游 origin 当作可用默认值继续检查。
  assert.match(
    autoUpdater,
    /if \(!ZCODIUM_UPDATE_ORIGIN\) \{/,
    "autoUpdater 缺少未配置自有更新源时的提前返回",
  );
  // forceUpdateGuard 同理：上游 client configs 不是本仓库的控制面。
  assert.match(
    guard,
    /if \(!ZCODIUM_UPDATE_ORIGIN\) \{/,
    "forceUpdateGuard 缺少未配置自有更新源时的放行",
  );
});

test("更新与门禁路径都从共享常量读取自有更新源", async () => {
  for (const relative of UPDATE_PATH_SOURCES) {
    const source = await readFile(join(root, relative), "utf8");
    assert.ok(
      source.includes("ZCODIUM_UPDATE_ORIGIN"),
      `${relative} 未从 @zcode/shared 读取 ZCODIUM_UPDATE_ORIGIN`,
    );
  }
});

test("构建期注入自有更新源，未注入时为空串而不是上游地址", async () => {
  for (const relative of ["packages/desktop/tsup.config.ts", "packages/desktop/vite.config.ts"]) {
    const source = await readFile(join(root, relative), "utf8");
    assert.match(
      source,
      /__ZCODIUM_UPDATE_ORIGIN__: JSON\.stringify\(process\.env\.ZCODIUM_UPDATE_ORIGIN\?\.trim\(\) \?\? ""\)/,
      `${relative} 的 __ZCODIUM_UPDATE_ORIGIN__ 定义不是「未注入即空串」`,
    );
  }
});

test("共享常量未注入 define 时为空串", async () => {
  const source = await readFile(join(root, "packages/shared/src/env.ts"), "utf8");
  assert.match(
    source,
    /export const ZCODIUM_UPDATE_ORIGIN =\s*$\n\s*typeof __ZCODIUM_UPDATE_ORIGIN__ !== "undefined" \? __ZCODIUM_UPDATE_ORIGIN__\.trim\(\) : "";/m,
    "ZCODIUM_UPDATE_ORIGIN 缺少 typeof 守卫或空串缺省",
  );
});
test("更新缓存目录由应用身份派生，不与上游 ZCode 共用", async () => {
  const source = await readFile(join(root, "packages/desktop/electron-builder.config.js"), "utf8");
  // 注释中保留历史默认名是可以接受的说明文字；这里断言的是配置值本身不能写成字面量。
  assert.ok(
    !/updaterCacheDirName:\s*["']/.test(source),
    "updaterCacheDirName 被写死为字面量，应改为由 desktopProductIdentity.appId 派生",
  );
  assert.match(
    source,
    /updaterCacheDirName: desktopProductIdentity\.appId,/,
    "updaterCacheDirName 未由 desktopProductIdentity.appId 派生",
  );
});

test("更新源与缓存目录各有对应 spec", async () => {
  for (const spec of ["update-source-ownership.md", "update-cache-isolation.md"]) {
    const source = await readFile(join(root, ".agents/specs", spec), "utf8");
    assert.ok(source.length > 0, `缺少 spec：${spec}`);
  }
});
