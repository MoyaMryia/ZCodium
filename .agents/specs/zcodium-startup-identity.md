# ZCodium 启动标识一致性

## 产品规则

启动期间只允许出现**一个**静态品牌标记，且标记必须是 ZCodium 珊瑚，不得再出现 Z 字标，
也不得有任何启动动画，更不得出现"透明窗口上浮着一个 logo 方块"的画面。

1. **HTML 启动壳已整套删除**：`packages/desktop/src/renderer/index.html` 与
   `packages/web/index.html` 不再渲染 `#loading` / `.zcode-boot-loading` 浮层、浮动 logo
   方块、遮罩脚本或预渲染 logo。桌面端只保留一层纯色根背景，避免 React bundle 执行前
   主窗口（透明/vibrancy）露出桌面；Web 端沿用既有 bootstrap 主题背景。
2. **React 侧是唯一启动画面**：启动门禁阻塞期由 `RootStartupLoading`
   （`packages/ui/src/root/RootStartupLoading.tsx`）承接主题背景并渲染静态
   `ZCodeStartupLogoBadge`；数据库启动态由 `GlobalDatabaseStartupLoading` 的
   `DatabaseStartupSurface` 承接，失败态必须始终可操作。
3. **不放动画**：桌面壳弹动、Web 壳呼吸、`prefers-reduced-motion` 启动分支，以及
   `disableStartupAnimation` 设置项（协议字段、schema、设置页开关、i18n、localStorage 镜像）
   全部不存在，不留空开关。
4. **不再有启动壳握手**：`zcode-react-startup-ready` 事件与 `#root` 透明度门禁已删除；
   `StartupReadyNotifier` 只记录 T5（React 首次 commit）耗时。
5. **品牌图标单一来源**：`ZCodeStartupLogoBadge` 与 `ZCodeAboutLogo` 共用同一枚
   `public/logo/icons/512x512.png`；启动期只有这一处标记，不存在"两个珊瑚尺寸不一致"。
6. **Linux 桌面条目唯一**：deep link 注册写入的用户级条目 id 必须是 `zcodium.desktop`，
   与 deb/rpm 安装的系统级条目同名，这样"系统级条目已存在就不写用户级"的遮蔽抑制才会生效；
   `Name`/`StartupWMClass` 取构建期产品身份（`desktop-product-identity.mjs`），不取 `app.name`。
   历史遗留且带归属标记的用户级 `zcode.desktop` 必须被清理，收敛成一个图标。

## 所有者与接口

- 启动画面：`packages/ui/src/root/RootStartupLoading.tsx`（门禁期）+
  `packages/desktop/src/renderer/src/main.tsx` 的 `GlobalDatabaseStartupLoading`（数据库期）。
  两者都自带 `bg-background`，启动期不再依赖 HTML 壳提供背景。
- 品牌图标：`packages/ui/src/root/ZCodeStartupLogoBadge.tsx` 与
  `packages/ui/src/components/ui/ZCodeAboutLogo.tsx` 引用同一枚
  `public/logo/icons/512x512.png`；空态水印用 `public/logo/watermark.png`
  （单色 alpha，不适合复用图标）。
- Linux deep link 条目：`packages/desktop/src/main/desktopLinuxDeepLinkRegistration.ts` 拥有
  文件 id、归属标记、Name/WMClass 与遗留清理；产品名由调用方
  `desktopOAuthDeepLink.ts` 从构建期身份模块（`packages/desktop/scripts/desktop-product-identity.mjs`）传入。
- 运行时应用名：`packages/desktop/src/main/desktopRuntimeEnv.ts` 的 `runtimeApplicationName`
  取构建期产品身份；`migrateRuntimeUserDataDir` 负责把旧名用户数据目录整体搬到新身份目录。

```mermaid
sequenceDiagram
    participant HTML as index.html（无启动壳）
    participant React as Root
    participant DB as GlobalDatabaseStartupLoading

    HTML->>HTML: 只保留纯色根背景
    React->>React: 数据库就绪前渲染 DatabaseStartupSurface
    React->>React: 启动门禁阻塞期渲染 RootStartupLoading（静态珊瑚）
    React->>React: 门禁通过后进入主界面
```

## 验收

1. 冷启动到 React 接管之间，屏幕上只出现 ZCodium 珊瑚，不出现 Z 字标，也没有任何动画，
   更不出现"透明窗口上浮着 logo 方块"。
2. 仓库内不存在 `startup-logo-pop` / `zcode-boot-logo-breathe` / `zcode-boot-loading` /
   `startup-logo-shell` 等启动壳关键帧与样式，也不存在 `disableStartupAnimation` 设置项与其 i18n key。
3. 启动门禁阻塞期渲染 `RootStartupLoading`（静态、带 `bg-background`）；数据库失败时仍能看到
   状态、耗时与重试/退出按钮。
4. deb/rpm 安装后 `~/.local/share/applications` 不出现 `zcode.desktop`；已有遗留条目
   （带 `Comment=ZCode Desktop App` 归属标记）在下次启动被删除，用户手写条目不受影响。
5. `pnpm typecheck`、`pnpm lint`、`pnpm fmt:check`、`pnpm architecture:check --changed` 通过；
   `apps/zcode-cli` typecheck 通过。
