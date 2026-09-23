# ZCodium 更新缓存隔离

## 背景与问题

`packages/desktop/electron-builder.config.js` 的 `publish` 块只声明了 `provider: generic` 与占位
`url`，没有声明 `updaterCacheDirName`。electron-builder 因此写入默认值，实测打包产物
`Contents/Resources/app-update.yml` 为：

```yaml
provider: generic
useMultipleRangeRequest: false
url: http://localhost:8081
updaterCacheDirName: "@zcodedesktop-updater"
```

`@zcodedesktop-updater` 是从上游 ZCode 继承下来的名字。官方 ZCode 安装包的同一字段也是它，
两个应用于是共用 `~/Library/Caches/@zcodedesktop-updater`。

`electron-updater` 的 `DownloadedUpdateHelper` 会在 `pending/` 下按 `update-info.json` 记录
fileName 与 sha512，并用它们校验已缓存的安装包；缓存命中判定只看这两项，不看是哪个应用写入的。
实测该目录中存在官方 `ZCode-3.14.3-mac-arm64.zip`（244 MB，2026-09-22 下载）与对应的
`update-info.json`。一旦 manifest 指向同一版本，ZCodium 会把这份官方包当作自己的已下载更新。

## 产品规则

- ZCodium 的更新缓存目录必须与上游及其他 ZCode 衍生构建互不可见。
- 目录名由应用身份派生，不写死与身份无关的字面量。
- 渲染进程与主进程共用同一更新流程，缓存归属只由打包配置决定。

## 所有者与接口

- 唯一所有者：`packages/desktop/electron-builder.config.js` 的 `afterPack` 步骤
  `rewriteUpdaterCacheDirName`。
- 取值来源：`context.packager.appInfo.id`，即构建配置的 `appId`
  （`packages/desktop/scripts/desktop-product-identity.mjs` 的 `desktopProductIdentity.appId`），
  production 为 `dev.zcodium.app`，preview 为 `dev.zcodium.app.preview`。
- 运行时读取方 `electron-updater` 只消费该字段，不新增第二处配置。

### 为什么不是配置项

electron-builder 26 的 `AppInfo.updaterCacheDirName` 是派生只读属性：`AppInfo.js` 的
`this.sanitizedName.toLowerCase() + "-updater"`，`sanitizedName` 来自 `metadata.name`。
`PublishManager.getAppUpdatePublishConfiguration` 写 `app-update.yml` 时无条件使用
`packager.appInfo.updaterCacheDirName`，`publish` 下的同名键无处消费（实测写入后仍为默认值）；
`scheme.json` 里 `updaterCacheDirName` 只出现在各 publish provider 的选项定义中，
不存在可用于覆盖的顶层配置。因此只能在该文件写完后改写，不能靠配置声明。

### 执行顺序

`PublishManager` 通过 `packager.onAfterPack` 注册的 handler 在 `AsyncEventEmitter` 中标记为
`system`，用户 `afterPack` 标记为 `user`；`emit` 先执行 system 再执行 user。所以用户的
`afterPack` 里读到的 `app-update.yml` 一定是已被 electron-builder 写好的版本。

## 验收场景

1. 打包产物的 `app-update.yml` 中 `updaterCacheDirName` 等于 `<appId>-updater`，不再是
   `@zcodedesktop-updater`。修复前实测基线为 `@zcodedesktop-updater`。
2. production 与 preview 身份的构建得到不同的缓存目录名，两者互不覆盖。
3. 构建配置中不存在把 `updaterCacheDirName` 写死为字面量的声明。
4. `pnpm typecheck`、`pnpm lint`、`pnpm fmt:check` 与 CI 测试通过。

## 非目标

- 不清理用户机器上已存在的 `~/Library/Caches/@zcodedesktop-updater`；那是官方 ZCode 的缓存，
  属于用户环境，不由本仓库删除。
- 不修改 `app-update.yml` 的 `url` 占位值：运行时由 `setFeedURL` 覆盖，见
  `.agents/specs/update-source-ownership.md`。
