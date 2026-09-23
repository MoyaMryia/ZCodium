# 桌面应用图标网格与 Dock 尺寸

## 背景与问题

打包产物在 macOS Dock 中比同排其他应用大一圈。

实测两张 1024×1024 画布（alpha>128 的可见范围）：

| 图标                     | 画布      | 可见内容  | 四边留白 | 占比  |
| ------------------------ | --------- | --------- | -------- | ----- |
| ZCodium `build/icon.png` | 1024×1024 | 1024×1024 | 0 px     | 100%  |
| 官方 ZCode `icon.png`    | 1024×1024 | 832×832   | 各 96 px | 81.2% |

Dock 按**画布边长**等比缩放图标，可见形状占画布多大直接决定观感尺寸。
Apple 的 macOS 图标网格是 1024 画布 / 824 内容（四边各 100 px 余量，供圆角、阴影与视觉呼吸）。
ZCodium 这张图是照 824 网格画的（实测圆角半径约 217 px，占比与官方圆弧一致），
但被放在了 1024 画布上且没有补边，于是可见尺寸比邻居大 `1024/824 ≈ 1.24` 倍，面积约 1.54 倍。

### 为什么不能只换 icns

Dock 图标有两条独立来源，同一张源图喂给两边：

- `Contents/Resources/icon.icns` —— Finder、Launchpad、切换器；
- `Contents/Resources/icon.png` —— `packages/desktop/src/main/index.ts` 的 `iconPath`
  （打包态解析到 `process.resourcesPath/icon.png`），在 `index.ts` 启动时交给
  `applyAppIcon()`（`packages/desktop/src/main/desktopWindowChrome.ts`），
  内部执行 `app.dock.setIcon()`。

只替换 icns 时，运行时 `setIcon` 仍会把满幅图设回 Dock，问题照旧。

## 产品规则

- macOS 图标素材遵循 1024 画布 / 824 内容网格，四边各留 100 px 全透明。
- 留白只加在**打包与运行时图标**上；`public/logo/icons/*` 是界面内 logo，
  缩小显示不加留白，不在本规则范围内。
- `icon_windows.png`、`icon.ico` 面向 Windows，不套 macOS 网格。
- 网格只作用于 macOS：Linux 窗口/任务栏图标用独立的 `build/icon_linux.png`（满幅 1024），
  不补留白，避免 Linux 上再出现“比同排应用小一圈”。

## 所有者与接口

- 素材所有者：`packages/desktop/build/icon.png`（macOS 源）与 `build/icon.icns`（派生）；
  Linux 另用 `packages/desktop/build/icon_linux.png`（满幅）。
- 分发方：`packages/desktop/electron-builder.config.js` 的 `extraResources`
  把 `build/icon.png` 拷为 `Contents/Resources/icon.png`；Linux 构建额外把
  `build/icon_linux.png` 拷为 `icon_linux.png`。
- 运行时消费方：`iconPath`（macOS → `icon.png`，Linux → `icon_linux.png`）→ `applyAppIcon()`；
  `icon.icns` 由 `Info.plist` 的 `CFBundleIconFile` 消费，两者不做二次缩放，
  因此留白必须在源图上一次性做好。
- `dmg.icon`（`build/icon_installer.icns`）尺寸由 DMG 布局坐标控制，不套应用图标网格。

## 验收场景

1. `packages/desktop/build/icon.png` 与 `icon.icns` 的 alpha>128 可见范围均为 824/1024，
   四边留白 100 px。
2. `icon.icns` 的 `ic10`（1024）分块可见范围为 824 px；`ic07`/`ic08`/`ic09` 等比例一致。
3. 打包产物 `Contents/Resources/icon.png` 与 `build/icon.png` 哈希一致；
   Dock 中可见尺寸与官方 ZCode 相差不超过 1 pt（tilesize 51 时约 41 pt）。
4. 替换已安装 app 的图标后，`codesign -dv` 仍报 `adhoc` / `Sealed Resources=none`，
   应用可正常启动。
5. Linux 构建的 `resources/icon_linux.png` 满幅可见 1024；`iconPath` 在 Linux 指向它，
   不再复用已补留白的 `icon.png`。

## 非目标

- 不迁移到 macOS 26 的 Icon Composer `.icon` 格式：electron-builder 26.x 只接受
  `.icns`/`.png`。
- 不改 `public/logo/icons/*` 与 `public/icon_512@2x.png`。
- 不改变 `icon.icns` 的分块集合；`iconutil` 产出比原文件多 `ic11`/`ic12`（32/64 实心），
  属于标准 icns 结构，向下兼容。
