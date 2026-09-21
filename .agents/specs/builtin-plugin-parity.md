# 闭源内置插件对齐（Built-in Plugin Parity）

## 背景

开源仓库相对官方 3.14.1 安装包缺少 12 个内置插件。差异来自开源提交
`44b25ed46c`「remove bundled plugins except browser use and cua」：该提交删掉了除
browser-use 之外的插件源码，但 `scripts/prepare-prebuilds.mjs` 的 staging 清单当时
未同步收敛，导致 `bootstrap:with-remote` 在 staging 第一个 manifest 时就抛
`missing remote official plugin manifest`。

本 spec 的目标是把其中 **9 个纯内容插件** 从官方 `resources/glm/packages/` 恢复到
`apps/zcode-cli/packages/`，并保持三处注册契约一致。

## 范围

### 纳入

| 包                                      | 内容形态                              | 运行时依赖                     |
| --------------------------------------- | ------------------------------------- | ------------------------------ |
| `@zcode/documents-plugin`               | skills + agents（DOCX）               | 无                             |
| `@zcode/pdf-plugin`                     | skills + agents（PDF）                | 无                             |
| `@zcode/spreadsheets-plugin`            | skills + agents（XLSX）               | 无                             |
| `@zcode/presentations-plugin`           | skills + agents（PPTX）               | 无                             |
| `@zcode/skill-creator-plugin`           | skills                                | 无                             |
| `@zcode/plugin-creator-plugin`          | skills + scripts（纯 `.mjs`，无构建） | 无                             |
| `@zcode/image-search-plugin`            | `.mcp.json`（HTTP MCP）               | 指向官方后端                   |
| `@zcode/restore-legacy-sessions-plugin` | skills + commands                     | 无                             |
| `@zcode/zcode-guide-plugin`             | skills + commands                     | 无                             |
| `@zcode/zcode-cua-plugin`               | SDK client + skill + docs             | 原生执行由 node_repl host 提供 |

### 排除

- `@zcode/android-emulator-plugin`、`@zcode/ios-simulator-plugin`：
  含原生 `.cc/.h/.node` 产物，不属于纯内容移植，单独排期。
- **CUA 的原生 runtime**：闭源侧 `zcode-cua-plugin/node_modules` 里有 koffi/sharp/detect-libc
  共约 20 MiB，是真正驱动鼠标键盘的部分。它不在 `requiredSeedPaths` 里，
  `official-plugin-definitions.ts` 也显式声明 `runtimeTopLevelPaths: []`。
  本次只移植 `scripts/computer-use-client.mjs`（模型可见面，只依赖 node: 内建模块）、
  `skills/computer-use/SKILL.md`、`docs/computer-use.md` 三项。
  远端工作区**有意不接收 CUA**：原生执行依赖 node-repl-host 的 `dist/mcp/server.js`，
  而宿主 runtime 不向远端发布；把 CUA 加进远端合同只会 seed 出看得见却调不到的残缺插件。
- 任何需要后端签名的能力（`image-search` 的 MCP 即属此类）：只移植契约，不保证
  离线可用；这点与闭源行为一致，不是缺陷。

## 状态所有者与契约

插件是否进入安装包，由 **三处清单共同决定**，必须逐字一致：

| 位置                                                                                                                              | 职责                        |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `scripts/prepare-prebuilds.mjs` → `remoteOfficialPluginPackages` / `remoteOfficialPluginRequiredPaths`                            | 远端 shared-host staging    |
| `packages/desktop/scripts/prepare-agent-node-bundle.mjs` → `officialPluginPackages`                                               | 桌面 agent node bundle seed |
| `packages/server/src/remote/zcodeAgentOfficialPluginAssets.ts` → `REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES` / `..._ASSET_PATHS` | 远端合同                    |

顶层白名单 `remoteOfficialPluginTopLevelPaths` 已覆盖 `.zcode-plugin`、`agents`、
`commands`、`docs`、`skills`、`scripts`、`package.json`，**本次不需要扩容**。

**唯一写入路径**：插件源码只存在于 `apps/zcode-cli/packages/<name>/`，安装包内的
`resources/glm/packages/<name>/` 由 staging 生成，不允许手工编辑。

## 验收场景

1. 每个包都存在 `.zcode-plugin/plugin.json`，且 `name` 与 `package.json` 的
   `name` 后缀一致。
2. `pnpm typecheck` 与 `pnpm lint` 保持基线（0 error；warning 不新增）。
3. 新增包被 `pnpm-workspace.yaml` 的 `packages/*` 自动纳入，无需改 workspace 配置。
4. 三处清单条目数与 9 一致，且 `stagedPath` 均为 `packages/<dir>`。
5. 不引入 `node_modules`、`.venv`、`__pycache__`、`*.pyc`（staging 过滤器已排除，
   提交时也不得带入）。

## 实测结果（2026-09-21）

| 命令                                  | 结果                                                     |
| ------------------------------------- | -------------------------------------------------------- |
| `pnpm typecheck`（root）              | 通过，0 error                                            |
| `pnpm --dir apps/zcode-cli typecheck` | 28/28 任务通过                                           |
| `pnpm lint`（root）                   | 70 warnings / **0 errors**                               |
| `pnpm --dir apps/zcode-cli lint`      | `@zcode/cli`、`@zcode/contracts`、`@zcode/adapters` 失败 |

CLI lint 的失败**全部为既有基线失败**，与本变更无关：已用
`git stash push -u` 回到干净基线复跑，失败集合完全一致（8 successful / 15 total，
同样失败 `@zcode/cli#lint` 与 `@zcode/contracts#lint`）。失败原因均为
`eslint(max-lines)`，落在本变更未触碰的文件上：

- `@zcode/cli`：`src/prompt-command.ts`(540)、`src/run.ts`(514)
- `@zcode/contracts`：`src/events/event-reducer.ts`(517)、
  `src/interfaces/browser-control.port.ts`(480)、`src/model/index.ts`(874)、
  `src/workflow/index.ts`(768)、`src/interfaces/session-store.port.ts`(1077)、
  `src/interfaces/dynamic-workflow-run.port.ts`(408)

新增的 10 个插件包**不声明 `lint` script**，因此不进 turbo lint 图——与仓库既有约定
一致（`browser-use-plugin` 的 lint 也只覆盖 `src`，不覆盖 `skills/` 与 `docs/`）。

`zcode-cua-plugin/scripts/computer-use-client.mjs` 原先是一个 1208 行的单文件
（vendored 长文件）。2026-09-21 的等价重写按 `apps/zcode-cli/AGENTS.md` 的 400 行
上限拆成五个模块，`client` 变为 340 行的装配层：

| 文件                        | 职责                                   |
| --------------------------- | -------------------------------------- |
| `computer-use-client.mjs`   | 装配、绑定、逃逸口、documentation 转交 |
| `computer-use-errors.mjs`   | 错误对象、broker 码映射、重试策略      |
| `computer-use-envelope.mjs` | MCP 结果读取、冷启动重试、投影给宿主   |
| `computer-use-target.mjs`   | App / Window 交互面与目标解析          |
| `computer-use-keys.mjs`     | 键位输入侧规范化                       |

拆模块的连带改动：`bootstrap` 的 `OFFICIAL_CUA_REQUIRED_SEED_PATHS` 与
`scripts/prepare-prebuilds.mjs` 的 `remoteOfficialPluginRequiredPaths` 都从 3 项
扩到 7 项。只 seed `client` 会装出一个看得见 computer-use、首次调用即
`ERR_MODULE_NOT_FOUND` 的残缺插件。

等价性用同一个 mock bridge 同时驱动新旧实现、逐场景比对全部可观测行为（bridge 收到的
调用、`nodeRepl.write`、`emitStructuredResult`、返回值、抛出的错误）来验证：49 个场景
× 3 个平台全部零差异。测试还对单个行为做了变异（`click_count` 默认值、重试策略、
broker 码映射）以确认它真能抓出差异。

## Computer Use 执行链分层核对（2026-09-21）

用户要求优先补全 Computer Use。逐层核对后确认：**可补全的部分已全部补完，
剩余缺口无法从官方安装包补全，且在当前平台不成立。**

| 层                                             | 开源仓库                   | 官方 3.14.1    | 缺口         |
| ---------------------------------------------- | -------------------------- | -------------- | ------------ |
| 模型可见面 `computer-use-client.mjs`           | 已移植                     | 有             | 无           |
| skill + docs                                   | 已移植                     | 有             | 无           |
| host bridge `node-repl-host/src/cua-bridge.ts` | **真实现**（204 行）       | 有             | 无           |
| host broker `node-repl-host/src/cua-broker.ts` | **真实现**（181 行）       | 有             | 无           |
| host 接线 `server.ts`                          | 有                         | 有             | 无           |
| 构建身份 `__ZCODE_CUA_HELPER_BUILD_ID__`       | 有（`tsup.config.ts:108`） | 有             | 无           |
| `@zcode/zcode-cua` runtime                     | **fail-closed 占位**       | 真实现 1.34 MB | **唯一缺口** |
| Helper 二进制 `ZCode Computer Use.app`         | 无                         | 安装包内也没有 | 不可移植     |

### 为什么剩余缺口补不了

真实现位于闭源 `node-repl-host/dist/mcp/server.js`，esbuild 模块边界
`node_modules/@zcode/zcode-cua/dist/index.js` 起于偏移 3,643,400，终于 4,982,852，
共 **1,339,452 字节 / 35,613 行**。已提取核对，内容是 **Helper 管理层**：
`helperInstaller`、`helperVerifier`、`helperRuntimeTrustPolicy`、`helperLauncher`、
`helperLocalDevAuthorization`、`redactHelperDownloadUrl`、`helperLaunchGuard`、
`CuaHelperError`（47 处）。它自己**不做原生调用**——无 koffi、无 CGDisplay/XLib/
SetCursorPos，`sharp` 是 `loadSharp()` 懒加载软依赖（取不到就继续）。

三条硬约束使其无法成为有效补全：

1. **仅支持 macOS**。`resolveCuaHelperInstallPlan` 首行即
   `if (platform !== "darwin") throw new CuaHelperError("install_failed", …)`。
   当前开发平台为 Linux，补进来也必然抛错。
2. **Helper 是捆绑产物，不是下载**。安装计划解析出
   `{ kind: "bundled", appPath }`；官方 Linux 安装包里同样没有这个 `.app`
   （全包唯一可执行文件是 `semver/bin/semver.js`）。
3. **要求捆绑的构建身份**。`ZCODE_CUA_HELPER_BUILD_ID` 为空时显式拒绝：
   "Packaged ZCode is missing its embedded Computer Use Helper build identity;
   refusing an unpinned Helper install"。该值由 CI 注入，本仓库的 define 是
   `process.env.ZCODE_CUA_HELPER_BUILD_ID?.trim() ?? ""`。

此外它是 **esbuild 构建产物而非源码**：35,613 行单文件，与仓库
「单文件默认不超过 400 行」的约定冲突，且无法与上游逐行对齐维护。

### 结论

`packages/zcode-cua` 的 fail-closed 占位是**正确且如实**的状态：没有 Helper
二进制、没有构建身份、平台不支持，此时返回不可用比返回一个跑不通的堆栈更诚实。
本 spec 范围内 Computer Use 的补全已结束，不再单独立项。

## 非目标

- 不实现 `chat.agentSwitch`、Claude slot mapping、bot 通知、Rewards 领取等需要
  后端或 UI 改造的能力；它们有各自的 spec。
- 不改动 browser-use / node-repl-host 的既有条目。
