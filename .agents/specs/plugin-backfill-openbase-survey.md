# A5b：内置插件补齐开源基座普查（Plugin Backfill Open-base Survey）

2026-09-23。目的：为建设 `android-emulator-plugin`、`ios-simulator-plugin` 与
`superpowers-plugin` 三个插件寻找开源基座。内容层文档的开源事实源记录见
`content-backfill-openbase-survey.md`。

## 三个基座

| 插件             | 基座                                                                                                                                | 许可 | 用法                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------- |
| superpowers      | `obra/superpowers`（★290k，231 文件，15 个 SKILL.md）                                                                               | MIT  | 技能内容派生，NOTICE.md 署名；覆盖 `builtinSkillI18n.ts` 里 13 条中的 14 个 |
| android-emulator | `martingeidobler/android-mcp-server`（★71，src/adb.ts + src/index.ts + 测试）                                                       | MIT  | ADB 封装层的事实源；MCP server 按公开 ADB 命令行自写                        |
| ios-simulator    | 无对口宽松许可 MCP 基座（`AlexGlkov/claude-in-mobile` ★373 无许可；`BariBariGood/manzanas` Apache-2.0 ★21 是 fleet 编排非单机驱动） | —    | MCP server 按 Apple 公开 `xcrun simctl` CLI 自写                            |

**明确排除**：`AlexGlkov/claude-in-mobile`（NO-LICENSE）、
`CarolaneLFBV/mcp-xcode-simulator`（NO-LICENSE）、`Reezxy/simctl-mcp`（MIT 但 ★0
无测试无文档，不作为基座）。

## 我们的插件结构（设计决策）

两个移动端插件的 MCP server 落在 `scripts/mcp/server.mjs`：本仓库免构建、
ESM `.mjs` 是既定约定（见 `zcode-cua-plugin/scripts/` 的六个模块），因此不引入
TypeScript 编译产物目录，而由 plugin.json 的 `mcpServers` 声明直接指向该脚本。
传输契约为标准 MCP over stdio（换行分隔的 JSON-RPC 2.0，initialize /
tools/list / tools/call / ping）。

## 实施结果（2026-09-23）

三个插件均已补齐并通过验证：

| 插件             | 结构                                                                                                                      | MCP server                                                             | 许可记录                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| superpowers      | 15 个技能（含各自 references/scripts/prompts 共 78 文件）+ 双 manifest + LICENSE                                          | 无（纯技能）                                                           | MIT 原文保留 + 每文件署名 footer + NOTICE.md 全量表 |
| android-emulator | skills/android-dev（SKILL + INSTALL_ENVIRONMENT）、commands、hooks、templates/compose-app、README、.mcp.json、双 manifest | `scripts/mcp/server.mjs`：18 个 ADB 工具，实测握手/tools/list/错误路径 | NOTICE.md（原创，公开 CLI 事实源）                  |
| ios-simulator    | skills/ios-dev、commands、hooks、templates/swiftui-app、README、.mcp.json、双 manifest                                    | `scripts/mcp/server.mjs`：15 个 simctl 工具，实测握手/错误路径         | NOTICE.md（原创，公开 CLI 事实源）                  |

接线改动：

- `official-plugin-definitions.ts` 增加 superpowers 定义（不默认启用，避开与
  `plugin-marketplaces.ts` 默认集合的单测机械对照；author 署名 Jesse Vincent）；
  android-emulator / ios-simulator 的定义原本就在，目录补齐后自动可解析。
- `bundled-plugins.ts` seed 白名单补 `NOTICE.md` 与 `LICENSE`：MIT 的署名义务
  要求版权声明与许可声明随内容一起分发，此前 NOTICE.md 不会被 seed 进 cache。

验证：bootstrap typecheck 通过、全仓 typecheck 通过、lint 57w/0e、架构 0 违规、
端到端技能扫描 34 个 SKILL.md CLEAN（剩余 10 条告警经核实全部是跨技能引用或
上游自身的示例性文字）、两个 MCP server 实测（initialize/tools/list/tools/call/
错误码/无工具环境优雅降级）。

端到端扫描复跑命令与判定标准记录在 `content-backfill-gaps.md`。
