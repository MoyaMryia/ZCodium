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
其中的 vendored 长文件（`zcode-cua-plugin/scripts/computer-use-client.mjs` 1208 行、
`restore-legacy-sessions-plugin/skills/restore-legacy-sessions/scripts/restore-conversation.mjs`
577 行）是闭源产物原样搬运，拆分会破坏与上游的逐字对齐，故保留原样。

## 非目标

- 不实现 `chat.agentSwitch`、Claude slot mapping、bot 通知、Rewards 领取等需要
  后端或 UI 改造的能力；它们有各自的 spec。
- 不改动 browser-use / node-repl-host 的既有条目。
