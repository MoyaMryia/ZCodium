# ZCodium 更新源归属

## 背景与问题

ZCodium 是 ZCode 的社区衍生仓库。上游 `packages/desktop/src/main/autoUpdater.ts` 在运行时通过
服务端 manifest provider 检查更新，默认 origin 为 `DEFAULT_ZCODE_ENDPOINT_ORIGIN`
（`packages/shared/src/zcodeEndpoint.ts`，值 `https://zcode.z.ai`）。

这带来三个不属于本仓库所有者的能力：

1. **更新源指向上游服务器。** 应用启动后请求
   `https://zcode.z.ai/api/v1/releases/electron/manifest?platform=darwin-aarch64&channel=1`，
   拿到的是**官方 ZCode** 安装包（实测 3.14.3，Bundle ID `dev.zcode.app`）。
2. **更新产物覆盖 ZCodium。** 本仓库构建的 appId 是 `dev.zcodium.app`，但
   `updaterCacheDirName` 仍是上游的 `@zcodedesktop-updater`，两个应用共用同一个更新缓存目录。
   已下载的官方包会以相同路径参与缓存校验，用户点更新会把官方包覆盖到 ZCodium 上。
3. **强制升级门禁由上游决定。** `packages/desktop/src/main/forceUpdateGuard.ts` 读取上游
   `/api/v1/client/configs` 下发的 `minimalVersion`。上游可据此阻止 ZCodium 启动。

结论：ZCodium 的升级路径必须由本仓库拥有，不能由上游服务端决定。

## 产品规则

- ZCodium 只从本仓库自己的分发位置获取更新；不向上游 manifest 或 client configs 发起请求。
- 未配置自有更新源时，**不检查更新**，而不是回退到上游。
- 自动更新检查、下载、强制升级门禁三者对「更新源归属」的判定必须同源，不能一处自有一处上游。

## 所有者与接口

- 更新源地址：构建期注入，单一来源。新增构建期常量 `__ZCODIUM_UPDATE_ORIGIN__`，
  与既有 `__ZCODE_CDN_BASE_URL__` 同层（`packages/desktop/tsup.config.ts` /
  `packages/desktop/vite.config.ts` 的 `createSharedDefines`），在
  `packages/shared/src/env.ts` 声明并导出 `ZCODIUM_UPDATE_ORIGIN`。
- 读取方：`packages/desktop/src/main/autoUpdater.ts` 的 `applyManifestUpdateProvider` 与
  `forceUpdateGuard.ts`，两者都只读该常量。
- 空值语义：`ZCODIUM_UPDATE_ORIGIN` 为空串时，`initAutoUpdater` 收到 `enabled: false`
  等价行为，force-update gate 直接放行。

## 分期

更新源归属与 macOS 自动更新是两件事，分开交付。

### 阶段 1：更新源归属（本 spec 覆盖范围）

- 新增 `__ZCODIUM_UPDATE_ORIGIN__` 构建期常量，默认空串。
- `autoUpdater`：origin 取该常量；为空时不配置 provider、不轮询，日志显式说明原因。
- `forceUpdateGuard`：origin 取该常量；为空时跳过门禁并记录日志。
- `updateFeedSource`（`ZCODE_UPDATE_FEED_URL` 调试开关）保留，但打包态仍按 `app.isPackaged` 忽略。
- 验收：构建时注入 `ZCODIUM_UPDATE_ORIGIN=https://example.invalid`，应用日志显示请求发往该地址；
  不注入时日志显示「未配置自有更新源，跳过检查」，且不出现任何指向 `zcode.z.ai` 的更新请求。

### 阶段 2：macOS 签名与自动更新（另行 spec）

macOS 的 `electron-updater` 走 Squirrel.Mac，安装前校验运行中 App 的代码签名。本地构建为
ad-hoc 签名（`flags=adhoc,linker-signed`，无 TeamIdentifier），自动更新会失败。要让 macOS
自动更新可用，前提是 Developer ID Application 证书 + notarization，这会同时改变
`electron-builder.config.js` 的签名门禁（`ZCODE_ENABLE_MAC_SIGN`）与发布流程。
在本阶段完成且验证通过前，macOS 渠道的更新能力视为不可用，升级方式是重新构建并覆盖安装。

## 非目标

- 不实现自有更新服务端；阶段 1 只切断上游依赖。
- 不修改上游 `manifestUpdateProvider` 协议，保留其作为自有 manifest 的消费端。
- 不改动 Windows / Linux 的既有打包与发布流程。
