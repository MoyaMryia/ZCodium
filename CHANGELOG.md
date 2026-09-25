# Changelog

## 3.14.3-1 (2026-09-25)

### Features

* add another ZCodium on README ([7c5dd23](https://github.com/axiom-desu/ZCodium/commit/7c5dd23401f0bbaa1318a2bcf7baaa27da017be6))

* align icons to the revised artwork and point image-search at a local backend ([e3082da](https://github.com/axiom-desu/ZCodium/commit/e3082da9f4fc11dde9c2ffa26c9139d003b4388b))
  * .zcode-plugin/plugin.json 新增 userConfig.imageSearchBaseUrl，
  * .mcp.json URL 由 ${ZCODE_BASE_URL}/... 改为 ${user_config.imageSearchBaseUrl}/...
  * .env.development 登记 ZCODE_OFFICIAL_MCP_DEV_TRUSTED_ORIGINS
  * .env.example 说明用途、覆盖路径与安全权衡
  * 新增「已定的补全路线」：bots 走 AstrBot 插件而非逐平台重写（四套平台适配、
  * 新增既定规则：上游发布功能但不放对应源码时，本仓库自行补齐等价实现并开源，不等待不申请。

* **bootstrap:** 给内建 node_repl 注入 cua-driver 运行时开关 ([bbb5bc6](https://github.com/axiom-desu/ZCodium/commit/bbb5bc6ae49fe5ae8f85f170481240fa24b543e8))
  * 仅当官方 CUA 插件启用时，向内建 `node_repl` server 的定向 env 注入：
  * 不动闭源 Helper 的 broker/sanitize 安全装配；开关只进官方 node_repl server。

* **bots:** add the AstrBot bridge for ZCodium agent sessions ([be2cda4](https://github.com/axiom-desu/ZCodium/commit/be2cda404b1c238de00fd155b6704b4736f6f599))
  * v2 bridge protocol (selection payload, centralized text commands, token)
  * BotsService/BotsRepo/BotsDeliveryLog/projector/interaction in services
  * loopback WS bridge server + IZCodeTaskService runtime adapter in host
  * spec: .agents/specs/bots-astrbot-bridge.md

* **bots:** 在官方 Bots GUI 中加入 AstrBot 桥接选项 ([#11](https://github.com/axiom-desu/ZCodium/issues/11)) ([37b2ba8](https://github.com/axiom-desu/ZCodium/commit/37b2ba8d86fe2749dfc12e5f026121b6fc3a9499))
  * feat(bots): 新增 astrbot provider 类型与适配器占位
  * 在共享 botProviders 中加入 astrbot，使官方 bots 合约/GUI 将 AstrBot 视为一等 provider。
  * 官方 botsService 的 provider→adapter 映射为 astrbot 留空：AstrBot 走独立桥接服务
  * feat(bots): 在 BotsDialog 中加入 AstrBot 桥接选项与设置卡片
  * 当前仅启用 AstrBot；官方平台适配器代码保留但置为未启用，待后续与桥接统一。
  * AstrBot 无平台凭据/二维码，新增专用 AstrBotSettingsCard：展示桥接运行时文件路径
  * 补充 zh-CN / en-US 文案。

* **bots:** 手机远控入口加入 AstrBot 并补齐其本地化 ([#12](https://github.com/axiom-desu/ZCodium/issues/12)) ([dafc9a3](https://github.com/axiom-desu/ZCodium/commit/dafc9a3ccbcfeb91e9b49f23672206f2b2ba1faa))
  * WebRemoteControlDialog 的 Bot Channel 入口新增 AstrBot（当前仅 AstrBot 可用，其余渠道保留）。
  * 补齐 AstrBot 的 i18n：bots.channel.astrbot、bots.newBot.providerDescription.astrbot、

* **bots:** 把 AstrBot 整合为官方 BotsService 的传输 provider ([#14](https://github.com/axiom-desu/ZCodium/issues/14)) ([ceaa563](https://github.com/axiom-desu/ZCodium/commit/ceaa563388f9416a90ecda874cd5ed88f3257795))
  * docs(bots): 记录 AstrBot 整合进官方 BotsService 的目标（I1–I6）
  * feat(bots): 新增官方 astrbot 传输 provider 与任务生命周期收口
  * 新增 IAstrBotBridgeService（传输控制面）与 createAstrBotBotProvider：
  * BotProviderAdapter 增加可选 notifyTaskLifecycle，官方服务在任务流启动、
  * createBotsService 支持注入 astrBotProvider，node.ts 组合根注册并接入。
  * feat(bots): host 切换到 astrbot provider 传输，并放开官方已实现的 Bot
  * botsBridgeServer 端口去耦：入站交 IBotsService.handleProviderCallback，
  * host startBotsBridge 改为：确保 astrbot BotConfig、attach transport、
  * botsUi 将官方已实现适配器的 provider（weixin/feishu/lark/telegram/webhook）标为 implemented。
  * refactor(bots): 删除旧 AstrBot 独立桥接实现
  * 删除 astrbotBridgeService / botsRepo / domain / botsEventProjector /
  * actorKey/bindingId 派生内联进 astrbotProvider（provider 私有）。
  * services/node 只保留 BotsDeliveryLog 导出（botsBridgeServer 仍需 BotsDeliveryReplay）。
  * 更新 AstrBotSettingsCard 注释。保留 shared/bots/bridge.ts wire 协议不变。
  * feat(bots): v2.0 桥接配置一次性迁移并备份
  * 启动时读取旧 bots-bridge.v2.json 的 enabled/allowedWorkspaces 用于创建 astrbot BotConfig，
  * feat(bots): AstrBot 真实设置卡、每命令一 stream、官方 provider 放开
  * AstrBotSettingsCard 升级为真实卡：连接/绑定状态、绑定码面板、解绑、插件入口，
  * astrbotProvider 轮次细化为「每命令一个 stream」：命令流在启动任务时提升为任务流，
  * botsUi 已放开官方实现 provider（上一提交）。
  * 补齐 bots.astrbot.boundDescription/unboundDescription 双语 key。
  * 配套插件另库提交：修正 accepted 关联、channel 统一 astrbot。
  * docs(bots): 同步 v2.1 每命令一 stream 与 channel=astrbot 语义
  * chore: 停止跟踪输入用的根目录 favicon.svg（保留在工作区）

* **bots:** 用 AstrBot 图标替换占位 logo ([#13](https://github.com/axiom-desu/ZCodium/issues/13)) ([99c9082](https://github.com/axiom-desu/ZCodium/commit/99c9082a5fc6b1487f2b97be85d909f551986c31))
  * 新增 packages/ui/src/assets/channel-icons/icon-astrbot.svg：AstrBot 星形图标
  * channel-icons 导出 AstrBotChannelIcon。
  * ProviderIcon 对 astrbot 使用该图标，替换原来的通用 Bot lucide 占位，

* **catalog:** bundle recommendations and automation templates locally ([822e554](https://github.com/axiom-desu/ZCodium/commit/822e554ab24a97f1c0072c1db28eb8c5541bb482))

* **cli:** add documents-plugin docx post-check and field repair scripts ([fabfd43](https://github.com/axiom-desu/ZCodium/commit/fabfd43d3e64e2a7aae92dd6cb4df13620b9eaa0))

* **cli:** add pdf-plugin and return it to the four release manifests ([e7fddd5](https://github.com/axiom-desu/ZCodium/commit/e7fddd52fbc22c99c50303b8c079d25a2fef33a6))

* **cli:** add repo-snapshot-parody, a localhost reimplementation of the closed-source snapshot upload ([32c8113](https://github.com/axiom-desu/ZCodium/commit/32c8113e87283ece6666e54d61a1a900b9a9c21b))
  * 目标固定 127.0.0.1，assertLoopbackTarget 拒绝非回环
  * RSA 密钥对本地生成，私钥落在用户自己的状态目录；因此 decrypt 真能还原，

* **cli:** add repo-snapshot-parody, a localhost reimplementation of the closed-source snapshot upload ([ff56d5a](https://github.com/axiom-desu/ZCodium/commit/ff56d5a71b5081ed7b0a057c34df52d86bd6703f))
  * 目标固定 127.0.0.1，assertLoopbackTarget 拒绝非回环
  * RSA 密钥对本地生成，私钥落在用户自己的状态目录；因此 decrypt 真能还原，

* **cli:** add spreadsheets-plugin and return it to the four release manifests ([7aeffac](https://github.com/axiom-desu/ZCodium/commit/7aeffac19e3bac87b8e2999653046912e1751585))

* **cli:** add the android-emulator and ios-simulator plugins ([afc7ce3](https://github.com/axiom-desu/ZCodium/commit/afc7ce3c9297ec3a01bd1a2815ebf633198efd02))
  * android-emulator: 18 ADB-backed tools (devices, install, launch, input,
  * ios-simulator: 15 simctl-backed tools (devices, runtimes, boot lifecycle,

* **cli:** add the documents routing, API reference and environment layer ([fa4fef9](https://github.com/axiom-desu/ZCodium/commit/fa4fef9aa8c57e8146d00d847a6f9d725a6fe93a))

* **cli:** add the documents scenes and remaining reference layer ([23488d1](https://github.com/axiom-desu/ZCodium/commit/23488d10f4d858c8c74e51af32a54aa5ff79b86f))

* **cli:** add the documents-plugin docx skill and visual-judge agent ([239d33a](https://github.com/axiom-desu/ZCodium/commit/239d33aa3c896688ddd71d827c743013da0f46a7))

* **cli:** add the pdf typesetting and render layer ([273b5fb](https://github.com/axiom-desu/ZCodium/commit/273b5fba9a7af337dec60d9b33545705c36714fb))

* **cli:** add the pdf_qa quality gate as a clean-room rewrite ([cf477d0](https://github.com/axiom-desu/ZCodium/commit/cf477d021b6be39e9e2c2b50de1c4e27c905e3ce))

* **cli:** add the slide design reference ([3f49e20](https://github.com/axiom-desu/ZCodium/commit/3f49e2066715868a6545bfebfe243b710ab5c40d))

* **cli:** add the superpowers skills plugin ([4b1961b](https://github.com/axiom-desu/ZCodium/commit/4b1961b6f99dc2236d8271616d3c5dc63be0c2c9))

* **cli:** clean-room the documents-plugin docx editing core ([6f939bd](https://github.com/axiom-desu/ZCodium/commit/6f939bd47f32f9ff82f9848766f1c8a60d82b8a5))
  * import 通过（Python 3.10）
  * _update_settings 签名为 (self, path, track_revisions=False, update_fields=True)
  * author 默认为 ZCodium
  * 打包产物可被 zipfile 回读，1786 bytes
  * trackRevisions / updateFields / rsids 均已插入且含本会话 RSID
  * 子元素顺序符合 CT_Settings（索引严格递增）
  * 原有 defaultTabStop / compat / clrSchemeMapping 保留
  * 格式化空白已剥除

* **cli:** complete the documents skill content layer ([0036aaf](https://github.com/axiom-desu/ZCodium/commit/0036aafd6602abf68dde45a940501f95c3853d6c))

* **cli:** complete the pdf skill ([95733ba](https://github.com/axiom-desu/ZCodium/commit/95733bac216a9a11642d8c87066ed48d9cfb1965))

* **cli:** complete the spreadsheets skill content layer ([c014b65](https://github.com/axiom-desu/ZCodium/commit/c014b6555ad3c20338f552f39c35dd63ac0f6760))

* **cli:** derive the pdf inspection and form toolset from the MIT base ([88779cb](https://github.com/axiom-desu/ZCodium/commit/88779cba72c42956212a010af2b01d5fc264af33))

* **cli:** document the workflow artifact declarations ([d0e6e32](https://github.com/axiom-desu/ZCodium/commit/d0e6e3212cd32241e336fb156c692cf4121b7377))

* **cli:** restore built-in plugins removed by the open-source scrub ([64da32c](https://github.com/axiom-desu/ZCodium/commit/64da32c1f83f3afa16fa832871c84180282ba99b))
  * zcode-cua-plugin（computer-use）
  * scripts/prepare-prebuilds.mjs: builtinContentPluginPackages + cuaPluginPackage
  * packages/desktop/scripts/prepare-agent-node-bundle.mjs: 同源清单
  * packages/server/src/remote/zcodeAgentOfficialPluginAssets.ts: 远端合同

* **cli:** return documents to the four release manifests ([66da966](https://github.com/axiom-desu/ZCodium/commit/66da9662d99381800bc0f8a178ffd185b6969694))

* **cli:** rewrite the Computer Use SDK as five equivalent modules ([5b728b6](https://github.com/axiom-desu/ZCodium/commit/5b728b646733dfe777bbb1edf2516ca9d0ed4683))
  * computer-use-errors.mjs    错误对象、broker 码映射、重试策略
  * computer-use-envelope.mjs  MCP 结果读取、冷启动重试、投影给宿主
  * computer-use-target.mjs    App / Window 交互面与目标解析
  * computer-use-keys.mjs      键位输入侧规范化
  * 信封读取从十四个小函数改为分层：原始形状抽取 → 语义读数 → 策略判定。
  * 重试策略从内联三元链提为 decideRetryPolicy()，actionSent 优先于错误码的
  * 键位别名表从平铺的「写法→token」改为「token→多种写法」再反查构建，两种拼法
  * assertUsable 的返回值此前被 bindApp 丢弃，现在 observe() 复用它取收据，
  * check-sdk.mjs 从「文件存在」升级为「文件存在且能 import」——文件在但语法错
  * OFFICIAL_CUA_REQUIRED_SEED_PATHS 3 → 7 项
  * remoteOfficialPluginRequiredPaths 里 CUA 3 → 7 项

* **cli:** rewrite the dynamic-workflows skill as its own text ([4c5b652](https://github.com/axiom-desu/ZCodium/commit/4c5b65275ee157315a7b7c9aa03bedcb2f569595))

* **cli:** rewrite the legacy session restore plugin as eight modules ([9446628](https://github.com/axiom-desu/ZCodium/commit/94466283527eb83cdaddb580fd2a1479d28e29fe))
  * 信封/取值助手从「每个文件各写一份」提为共用模块。原先恢复与扫描各自实现了
  * SQL 三条冲突策略原样保留：title 只在未自定义时更新、created/updated 取极值、
  * part id 的消息序号与 part 序号各补 4 位——字典序即时间序，LIST 查询依赖它。
  * 第一版 fixture 预置的 task 行用了路径形式的 workspace_key，而恢复用的是
  * part id 补位宽度、restoreState 判定、message id 格式三个变异同样现形

* **cli:** rewrite the plugin-creator scaffolding helpers ([3536211](https://github.com/axiom-desu/ZCodium/commit/3536211037dfd4441d7b054cf6e0a2eea0515b7d))
  * scaffold-files.mjs 从四个并列 if 块改为表驱动：COMPONENT_OUTPUTS 一个条目说清
  * marketplace-files.mjs 把内联的越界判定提为 escapesRoot()，validate-plugin.mjs
  * manifest 字段与文件产出都改为按固定顺序（skills/commands/hooks/mcpServers），
  * 「第二次运行」用例原先传了字面量 "MKT" 当 marketplacePath，resolve 后是不存在
  * 缺「已有其他 locale 时 nameZh 是合并而非覆盖」用例，补上后 i18nmerge 变异现形。
  * 缺「同样输入跑第二次 changed 必须为 false」用例，补上后 alwayswrite 变异现形。

* **cli:** rewrite the presentations plugin ([e129568](https://github.com/axiom-desu/ZCodium/commit/e1295684a4e019b63043f77cbc937034092ff6a5))
  * frontmatter 逐字保留。SKILL.md 的 description 是触发契约（列举了 .pptx、
  * 18 个代码块逐字保留：它们是 pptxgenjs / python-pptx 的 API 示例，
  * 事实数据逐字保留：13.33 × 7.5" 画布、44–72pt / ~24pt / 12pt 字号阶梯、
  * LICENSE.txt 逐字保留（专有非商业许可的完整条款）。

* **cli:** rewrite the skill-creator and image-search plugins ([23202a5](https://github.com/axiom-desu/ZCodium/commit/23202a583b4d76693d076c27187b6d8f5fad0f4b))
  * 默认值 → http://127.0.0.1:8787/api/v1/mcp/server/image_search
  * 覆盖为 https://api.z.ai → 正确替换
  * 改端口 → 正确替换
  * 键名命名空间化为 plugin:image-search:image_search
  * auth 与 timeoutMs 原样透传，provenance 由宿主生成而非插件声明

* **cli:** rewrite the zcode-guide configuration and diagnostic skills ([5e254ff](https://github.com/axiom-desu/ZCodium/commit/5e254ffa0b4e0a01158ca9670370d739385a047c))
  * zcode-configuration-guide：配置文件路径与字段、两类 scope、五个资源的
  * diagnosing-mcp：17 项，含两种 schema 形状（mcp.servers 嵌套 vs mcpServers
  * diagnosing-hooks：30 项，含七个事件名与三个不支持的事件、三类匹配值、
  * diagnosing-skills / diagnosing-commands / diagnosing-plugins：各自的名称

* **cua:** bundle native runtime for offline Linux and Windows ([c843beb](https://github.com/axiom-desu/ZCodium/commit/c843beb5144228b8756fcb8b32e2b7485fda3601))

* **desk-pilot:** stage1 cross-platform desktop control surface contract ([e05d6d3](https://github.com/axiom-desu/ZCodium/commit/e05d6d3a8df3b227aca351ba0363b6b1a5bb28a7))
  * 能力声明优先：CapabilitySet 在 daemon 启动时探测并冻结，工具表按能力裁剪；
  * 四级感知阶梯 a11y -> ocr -> dom -> vision，每个元素带 provenance/confidence/observed_at
  * 稳定 ref 寻址而非坐标；坐标是最后手段且必须绑定 frameId
  * 可验证执行：expect 谓词复检后返回 verified | deviation | unverified，deviation 不当成成功
  * Action Lease：桌面是独占资源，子代理默认拒绝
  * architecture-policy.yaml 注册 managed 模块 desk-pilot
  * package.json typecheck 加入 packages/desk-pilot
  * knip.json 补 workspace entry
  * .gitignore 忽略 DeskPilot 的 Rust 构建产物；同时把仓库根手动放置的桌面安装包

* **desktop:** apply the ZCodium identity to the packaging metadata ([53432d5](https://github.com/axiom-desu/ZCodium/commit/53432d538f856077ab040e73c6d20b1ccabd5340))
  * PRODUCTION_IDENTITY：productName ZCode -> ZCodium，
  * PREVIEW_IDENTITY 同步：ZCodium Preview / dev.zcodium.app.preview /
  * electron-builder.config.js 的 extraMetadata.author 与 linux.maintainer
  * packages/desktop/package.json 的 description / author
  * afterPack 里两处 .app 名 fallback 默认值

* **desktop:** replace remote rollout and help config with local defaults ([38632de](https://github.com/axiom-desu/ZCodium/commit/38632decf337e6693feb85ac8e503c2047dddadf))

* **desktop:** 加 cua-driver 的 macOS 权限申请与设置面板平台能力 ([001ae89](https://github.com/axiom-desu/ZCodium/commit/001ae89caa8c14131282ed2d0d639ca9194b6a9d))

* **diagnostics:** add private local records and opt-in OTLP export ([a56d353](https://github.com/axiom-desu/ZCodium/commit/a56d3535b95b3422dec46adb8e49d5da24b67a9f))

* fixed readme.md ([2cc3f0d](https://github.com/axiom-desu/ZCodium/commit/2cc3f0df49306447c6be4bcf0e189f64d20c21b3))

* **mcp:** use self-managed image search without official authentication ([58a0ff7](https://github.com/axiom-desu/ZCodium/commit/58a0ff7ff8d2fe30ba4b84fac444ecddfd35d07d))

* open source ([872ad96](https://github.com/axiom-desu/ZCodium/commit/872ad960de7ec172591f7e1952f7849229f94521))

* **plugins:** make the bundled marketplace independent of official services ([b05c82e](https://github.com/axiom-desu/ZCodium/commit/b05c82e0521b57950bb004e7ae573622f2ad96da))

* **privacy:** replace official feedback uploads with upstream issues ([686d394](https://github.com/axiom-desu/ZCodium/commit/686d3949026b4909d37b3234eb9b3f114dd677d5))

* **provider:** fetch the model catalog for custom API Key providers ([6bba88b](https://github.com/axiom-desu/ZCodium/commit/6bba88b5ed183df2d885a07570b2409dbe7fadd3))

* **provider:** use bundled model catalogs without runtime downloads ([4e98b32](https://github.com/axiom-desu/ZCodium/commit/4e98b32058331c1f7a567f5f70598532b86cd049))

* rebrand icons to ZCodium and drop the Feishu/Discord links ([37cafcc](https://github.com/axiom-desu/ZCodium/commit/37cafcc7aefadf5b4a07b134f48264af0442319e))
  * public/logo/icons/{16,24,32,48,64,128,256,512,1024}x*.png、icon.ico、icon.icns
  * packages/desktop/build/icons/ 同尺寸阶梯、icon.png、icon_windows.png、
  * public/icon_512@2x.png（UpdateStatusDialog 的 macOS Dock 图标）
  * packages/web/public/favicon.ico 与 index.html 内嵌的 32x32 base64 favicon

* **remote:** deploy verified bundled components without runtime downloads ([1eb81b7](https://github.com/axiom-desu/ZCodium/commit/1eb81b76999c911b6075d195c16e1ff7280288bb))

* rename user-visible product name ZCode to ZCodium ([b1e7456](https://github.com/axiom-desu/ZCodium/commit/b1e7456ea3f8bc36a6afee0a27e770e43369b306))
  * packages/desktop/package.json productName（影响 .app 名、安装包名、
  * packages/web/index.html <title>
  * DesktopTopOverlay / WelcomeScreen / WindowsTopLeftLogo /
  * openrouter-attribution.ts 的 X-OpenRouter-Title 请求头
  * appCaCert.ts 的 CA 证书 organizationName
  * paths.ts 的 Windows 安装目录候选（4 处 Program Files/Programs 下的
  * desktopLinuxDeepLinkRegistration.ts 的 productName/iconName 默认值
  * desktopLinuxAppImageIcon.ts 的 LINUX_APP_ICON_NAME
  * i18n zh-CN 91 处、en-US 95 处
  * DEEP_LINK_SCHEME = "zcode"：改动会断 OAuth 回调与已有 deep link
  * contextBridge.exposeInMainWorld("zcode")：renderer API 面
  * @zcode/* 包名、ZCODE_* 环境变量、apps/zcode-cli/ 路径、~/.zcode 数据目录

* **share:** add validated offline conversation archives ([f81a770](https://github.com/axiom-desu/ZCodium/commit/f81a770378348aa64d4e747701ed18dd7a8625d2))

* **share:** export conversations as offline files ([ccf2989](https://github.com/axiom-desu/ZCodium/commit/ccf2989fd17e37f42183687d46ef89d4a5f7d211))

* **share:** import offline conversations and remove hosted sharing ([5078905](https://github.com/axiom-desu/ZCodium/commit/507890505542d30a1d31989043e24c76fffe27c0))

* **share:** restore imported contexts without cloud URLs ([64713d3](https://github.com/axiom-desu/ZCodium/commit/64713d3bcc63da0fecedaa31102dcb27e514d590))

* **ui:** disable first-run account login and onboarding splash by default ([350bbcf](https://github.com/axiom-desu/ZCodium/commit/350bbcf5ce8bfbc537a85c5d36ce8ee196b560b1))

* **ui:** 解开 Linux 本机 Computer Use 限制 ([5684b8c](https://github.com/axiom-desu/ZCodium/commit/5684b8ce3e8cc5cfe50a2c92e5da28902c5f923a))
  * `resolveComputerUseAvailability`：`local-linux` 由 supported:false 改为 true；
  * `ComputerUseSection`：新增 `supportsLocalLinuxWorkspace`，Linux 本机渲染插件总开关 +
  * `PluginsSection` 的 unavailable 提示随之不再对 local-linux 展示。

* update v3.14.3 ([328c1a0](https://github.com/axiom-desu/ZCodium/commit/328c1a0c0ffaa5a4f65e8fa199af5e4c20706e5f))
  * The concurrency limit of a running workflow can now be adjusted directly, without stopping the task.
  * Optimized the reuse logic when modifying and restarting workflows.
  * Improved the real-time status display for large workflows.
  * Improved the efficiency of workflow script submission and modification, reducing token consumption.
  * Fixed an issue where workflows could cause the interface to crash in some cases.
  * Fixed an issue where buttons on workflow cards were sometimes pushed out of the interface.
  * Fixed an issue where the workflow tool took up too much context.

* updated readme.md ([bd10354](https://github.com/axiom-desu/ZCodium/commit/bd103540cfe36b81896fe0d525aac07323b2a2f0))

* **zcode-cua:** Linux/macOS 平台装配 + host 接线 ([fb4daba](https://github.com/axiom-desu/ZCodium/commit/fb4dabab39f5daf4af0e114c2575976ae045a8f9))
  * 新增 `packages/zcode-cua/platform.js`（+ `platform.d.ts`）：
  * `resolvePlatformPath` 判定 → 组装运行时；
  * Linux 老 GNOME 自动组装 compat（helper+backend+executor，注入 client）；
  * macOS 走 cua-driver 原生并报告 `requiresMacOsPermissions`（TCC 归嵌入宿主）；
  * `probeGnomeEnvironment()` 同步探测 shell/portal/WinRects 版本；
  * 缺 client → fail-closed。
  * `node-repl-host/server.ts`：`captureComputerUseRuntimeFromEnvironment` 改为按平台装配，
  * 导出 `./platform`（含 types）。
  * 平台文档状态更新；Windows 嵌入由另一路负责。

* **zcode-cua:** M2 前后台回退，后台拿不到就前台 ([0b1d1d8](https://github.com/axiom-desu/ZCodium/commit/0b1d1d879c7dad51b96d95dfafe20cdb481d8f7f))
  * driver 路径：输入类工具返回 `background_unavailable`（含抛出）时自动以
  * 兼容层路径：mutter 全局注入只能前台，结果统一标 `deliveryMode:"foreground"`。
  * 决策见 `computer-use-capabilities.md` §0/§3.5。

* **zcode-cua:** M3 观测 baseline/diffing ([3138353](https://github.com/axiom-desu/ZCodium/commit/3138353b5c73656facd9dbfed1098e71596fdec7))
  * 每个 (pid, window) 记 baseline 指纹；模型未看过（tree_shown_to_model:false）不置 baseline。
  * 之后观测只发相对 baseline 变化的元素，`disable_diffing` 强制全量；结果标 `_meta.diff`。
  * 元素 index 解析仍用完整快照，diff 只影响返回给模型的行。

* **zcode-cua:** M4 actionSent 推导 + 冷启动重试 ([3345cc7](https://github.com/axiom-desu/ZCodium/commit/3345cc7e22a2ae0343b0f13150bf1df65e7e75c1))
  * actionSent（§3.3）：成功→true；不确定投递（possibly_sent）→true+possiblySent；
  * 冷启动（§3.4）：driver 抛 CUA_NOT_READY / not-ready 时按 250/500/750/1000/1500ms
  * 顺带 `eslint-disable max-lines`（按仓库惯例，带理由）。

* **zcode-cua:** ZCode 模型面（14 工具）映射层，本机跑通 ([9886e79](https://github.com/axiom-desu/ZCodium/commit/9886e79aea2bc6a416d6e8b70228737bedd0bdfd))
  * 新增 `.agents/specs/computer-use-capabilities.md`：能力总表、14 工具映射表、
  * 新增 `surface.js`：ZCode 工具名 → cua-driver 或兼容层；`target:number` 解析到最新
  * `runtime.js` 接入：ZCode 工具名走 surface，cua-driver 原生名仍透传；兼容层只接管输入类。

* **zcode-cua:** 全平台执行路径判定 resolvePlatformPath ([f0e1a36](https://github.com/axiom-desu/ZCodium/commit/f0e1a363259a21039beea845b27ab40747bd1bd7))

* **zcode-cua:** 兼容层 C2/C3，GJS helper + backend + detect ([32e1453](https://github.com/axiom-desu/ZCodium/commit/32e1453323fb02f1ccdc23343e7773d83307fb31))
  * `compatible/helper/cua-wayland-input.js`：GJS 长驻 helper，JSON-lines over stdio，
  * `compatible/helper-client.js`：Node 侧 spawn/监督、按 id 匹配响应、stderr 透传、
  * `compatible/backend.js`：组合 evdev/geometry 与 helper 原语，提供
  * `compatible/detect.js`：Linux ∧ Wayland ∧ GNOME ∧（Shell<45 ∨ portal<2）∧ WinRects 可达。

* **zcode-cua:** 兼容层 C4，接入 createComputerUseRuntime 兜底路由 ([da3817c](https://github.com/axiom-desu/ZCodium/commit/da3817c8982a736a3d3daeb565a9d194689c3adb))
  * `compatible/executor.js`：把 cua-driver 形状的输入类工具翻译到 compat 后端；
  * `runtime.js`：`createCuaDriverRuntime(client, { compat })`，仅当 compat.applies 且
  * `index.d.ts`：新增 ComputerUseCompatExecutor 与 runtime options.compat。
  * 单测 70/70；真实链路验证：detect 判定 GNOME 42 适用，driver 观察 462 元素，

* **zcode-cua:** 兼容层 C6，scroll/drag 原语 ([5b3491e](https://github.com/axiom-desu/ZCodium/commit/5b3491e6443e469f7317156f75027cc6e3062957))
  * helper 新增 `axisDiscrete` / `axis`（NotifyPointerAxisDiscrete / NotifyPointerAxis）。
  * backend 新增 `scroll(direction, amount)`（映射轴向与符号）与
  * executor 实现 `scroll`（按指针位置，先把指针移到元素或窗口中心）与
  * spec §6.5 记录 mutter 滚动/拖拽语义与验证结果。

* **zcode-cua:** 加 macOS TCC 权限的宿主侧入口 ([3bb5226](https://github.com/axiom-desu/ZCodium/commit/3bb52265d410923a8ee9e215b3cbf50e3fe9881c))

* **zcode-cua:** 加 macOS 嵌入宿主装配（二进制解析 + EmbeddedCuaDriverHost） ([6688839](https://github.com/axiom-desu/ZCodium/commit/66888391cd6813d2f9e87a66d9e7b4ea6186af55))

* **zcode-cua:** 加权限服务的平台装配 assembleCuaPermissionServiceAsync ([26b7a63](https://github.com/axiom-desu/ZCodium/commit/26b7a63a5c0d02c69baefb1f6545b49bf418fc86))

* **zcode-cua:** 复用 cua-driver 作为唯一原生引擎，移除 desk-pilot ([c34d389](https://github.com/axiom-desu/ZCodium/commit/c34d389efedb112b11b53bece721676b231960f7))
  * 新增 `createComputerUseRuntime`：把 `@trycua/cua-driver` 接到 ZCode 的
  * 删除自研 `packages/desk-pilot`（36 文件）及 `desk-pilot` / `generic-cua-runtime`
  * 新增 `.agents/specs/computer-use-runtime.md`（适配器契约与验收）。
  * 新增 `.agents/specs/computer-use-platform-architecture.md`：

* **zcode-cua:** 打包 cua-driver 依赖 + 装机流程，让 Computer Use 跑起来 ([3e93f5e](https://github.com/axiom-desu/ZCodium/commit/3e93f5eea20e61a36660c7ecfbb3d559e0720476))
  * 依赖：`packages/zcode-cua` 加 `@trycua/cua-driver@0.28.2`（含各平台原生包）。
  * 装配：`platform.js` 新增 `assembleComputerUseRuntimeAsync`——依赖包 exports 只有
  * runtime：`dispose` 兼容 cua-driver SDK 的 `shutdown()`（SDK 无 `dispose`）。
  * host：`node-repl-host` 的 `captureComputerUseRuntimeFromEnvironment` 改异步，
  * 装机：vendor 老 GNOME WinRects 扩展到 `compatible/helper/gnome-extension/`，

* **zcode-cua:** 新增 cua-driver 权限契约与后端，替代闭源 Helper 权限源 ([4a5b145](https://github.com/axiom-desu/ZCodium/commit/4a5b1459a43b9d2bfcb50daa51ae233bbd2d23ac))

* **zcode-cua:** 新增老 GNOME Wayland 物理输入兼容层（C1 纯函数） ([1cf6687](https://github.com/axiom-desu/ZCodium/commit/1cf6687b3ef7455cb65c5f61aed86f905126add9))
  * `compatible/evdev.js`：evdev 码表、修饰键别名、字符→键位、hotkey/按键序列、
  * `compatible/geometry.js`：元素 frame→屏幕像素（scale×center −(scale×W−B)）、
  * 单测 19 条（共 32/32 通过）。
  * 新增兼容层契约 spec，含坐标验证矩阵、键盘/文本分级、helper 决策、实施顺序。

* **zcode-cua:** 老 GNOME 扩展装机引导 + compat 就绪判定 ([64b268d](https://github.com/axiom-desu/ZCodium/commit/64b268d97e8d374a7d5232266cb946db0529558d))
  * `install-extension.mjs`：启用后探测 `org.cua.WinRects` 是否可达；可达 → “已就绪”，
  * `platform.js` 新增 `describeCompatReadiness(probes)`：老 GNOME 未加载扩展时返回


### Bug Fixes

* **bootstrap:** attribute the official plugins to ZCodium, not Z.ai ([5493286](https://github.com/axiom-desu/ZCodium/commit/5493286cf03eb32f42f0fa70bfc04f0156899a78))

* **ci:** accept AT-SPI button role variants in CUA smoke ([fd9d2b0](https://github.com/axiom-desu/ZCodium/commit/fd9d2b0e583f8f0a5128478b3d43bdbf1d966031))

* **ci:** allow isolated CUA namespaces on Ubuntu runners ([6a50797](https://github.com/axiom-desu/ZCodium/commit/6a5079798d373d4c6db4a513c82639d44a02607c))

* **ci:** arm64 交叉打包只校验资产，跳过原生加载探针 ([b58ba2a](https://github.com/axiom-desu/ZCodium/commit/b58ba2a51c3270f0c065ecd578335cab648ac4a7))

* **ci:** build Agent packages from the root workspace ([4819295](https://github.com/axiom-desu/ZCodium/commit/48192950270892454a79926ed398ae064aafe3b8))

* **ci:** collect Linux installers using native architecture names ([4c34a02](https://github.com/axiom-desu/ZCodium/commit/4c34a0230d8a2d46b7dd7264723eec656f119143))

* **ci:** load observability tests without CLI build artifacts ([786e15c](https://github.com/axiom-desu/ZCodium/commit/786e15c09e9ffac994e1c7d2b5a8ae87b46d09b7))

* **ci:** mark prerelease tags in draft releases ([2ad1451](https://github.com/axiom-desu/ZCodium/commit/2ad145136ee87c02d5ba39b5f43d9717ef436b73))

* **ci:** parse pinned toolchain before setting up Node ([a5dd19e](https://github.com/axiom-desu/ZCodium/commit/a5dd19e7ab74c6d56c266a724b29448d4c0b96e9))

* **ci:** 修 Windows arm64 交叉打包的两个断点 ([6e386d6](https://github.com/axiom-desu/ZCodium/commit/6e386d6013df08f4dfffec6932b9c249bbbf9f34))

* **cli:** drop the proprietary license files from the rebuilt plugins ([43f91ed](https://github.com/axiom-desu/ZCodium/commit/43f91edc17d2e447140fe4a7571c138306501d0d))

* **cli:** kill the whole process group when LibreOffice times out ([163381d](https://github.com/axiom-desu/ZCodium/commit/163381df836f15724eaf249f0fa5fd49b1cf0b87))

* **cli:** make the web-gui-tester frontmatter valid YAML ([7b56324](https://github.com/axiom-desu/ZCodium/commit/7b56324b5eda70ef27615626e7de8bcebd84461e))

* **cli:** repair the dead numbering-continuity rule in docx postcheck ([44e7f58](https://github.com/axiom-desu/ZCodium/commit/44e7f588443ab13284f47a22c7bf57e76b1982c7))

* **cli:** seed NOTICE.md and LICENSE into the plugin cache ([1b5ab41](https://github.com/axiom-desu/ZCodium/commit/1b5ab41e2ce584000904a95160ab78a113bf2219))

* **cua:** align SDK targets with the bundled native driver ([35c3958](https://github.com/axiom-desu/ZCodium/commit/35c39582ed1955c99b1d628eb645bee38d953eaf))

* **cua:** prevent stale window actions and unsafe retries ([367d7ad](https://github.com/axiom-desu/ZCodium/commit/367d7ad7e91299ad0ff754d32f8cd8be8db538d7))

* **desk-pilot:** stage1 make the Rust daemon compile and speak the TS wire format ([ae195fd](https://github.com/axiom-desu/ZCodium/commit/ae195fd43a53c26c1e8154d2652e11d82ea5219f))
  * PerceptionSource / AccessScope 是 BTreeMap 的 key，需要 Ord；
  * RequestContext 带 #[serde(default)]，需要 Default；
  * lib.rs 把 DESK_IPC_VERSION / MAX_REQUEST_BYTES / MAX_RESPONSE_BYTES
  * 三 target 全部通过 cargo check --workspace --all-targets、
  * cargo test --workspace：5/5 通过（新增的 wire_format.rs）
  * cargo build --workspace --release 通过（lto profile 可供 build.mjs 使用）
  * Linux 实测运行 daemon：起 socket、capabilities 返回 Wayland 诚实能力集
  * 提交 Cargo.lock：workspace 含 bin crate，锁文件保证可复现构建
  * pnpm typecheck exit 0；oxlint 0 error；oxfmt --check 全仓通过；

* **desktop,ui:** keep the ZCodium mark visible across the whole cold start ([3ce0f1c](https://github.com/axiom-desu/ZCodium/commit/3ce0f1c0ffbe865fcd134eed84f39af3cdbdc567)), closes [#root]()

* **desktop,web:** drop the transparent startup shell and restore the static React startup page ([a7d6cfe](https://github.com/axiom-desu/ZCodium/commit/a7d6cfec1a0946d5067870aaaaeb6e65c9a6bf6d)), closes [#loading]() [#root]()

* **desktop:** deep link 只保留 zcode:// 协议，清理 html 等误关联 ([#18](https://github.com/axiom-desu/ZCodium/issues/18)) ([37e139d](https://github.com/axiom-desu/ZCodium/commit/37e139ddc798b3979864f7ed28e92ac86b92b360))

* **desktop:** import the shared data dir name in the MCP user directory ([04376a5](https://github.com/axiom-desu/ZCodium/commit/04376a5a851094c9bd4281bf00f4504933e54459))

* **desktop:** keep the Linux window icon full-bleed ([ed4e365](https://github.com/axiom-desu/ZCodium/commit/ed4e365186a9566ca60f5ea83f63635c2129d8f3)), closes [#9]() [#9]()

* **desktop:** pad macOS app icon to the 1024/824 grid ([#9](https://github.com/axiom-desu/ZCodium/issues/9)) ([912e9bb](https://github.com/axiom-desu/ZCodium/commit/912e9bbb34702cb65314de50ba4794ddd494da2c))
  * Contents/Resources/icon.icns 供 Finder / Launchpad / 切换器；
  * Contents/Resources/icon.png 由 index.ts 的 iconPath 交给 applyAppIcon()，

* **desktop:** stage1 dev startup survives the invalid app version ([5af02e5](https://github.com/axiom-desu/ZCodium/commit/5af02e5b4fd37277585b56b300fa642e5f7f5bd1))
  * autoUpdater 改为首次使用时才解析，模块加载不再触发 getter，门禁恢复生效
  * 新增 constructAutoUpdater()：构造期间把 app.getVersion() 临时对齐到产品版本，

* drop the startup animation and the React startup page ([6fbede0](https://github.com/axiom-desu/ZCodium/commit/6fbede0bab96d087bb56fad8daee74cb73f9e201))
  * 删除全部启动动画：桌面壳的 startup-logo-pop 与 Web 壳的 breathe 关键帧、
  * 删除 RootStartupLoading 组件：启动门禁阻塞期 Root 只渲染 RootShell 与对话框宿主，
  * GlobalDatabaseStartupLoading 改用本地 DatabaseStartupSurface：保留进度、耗时、
  * 桌面壳移除动画后同步简化退场逻辑：标记直接落终态，壳只等 React ready

* **node-repl-host:** 打包时拷贝 CUA 兼容层 helper 目录并对齐生成类型 ([b8d63d9](https://github.com/axiom-desu/ZCodium/commit/b8d63d93e81e983cfa89ce64cde1f5efa6a64c53))
  * build.mjs：compatible/helper 是 gjs 运行的外部脚本，helper-client 用
  * dist-types/server.d.ts：captureComputerUseRuntimeFromEnvironment 已改为异步，

* play one ZCodium startup animation and register one Linux icon ([424a57a](https://github.com/axiom-desu/ZCodium/commit/424a57a67836523e3685f6aae1c825008b93ea13))
  * desktop/web 的 HTML 启动壳改用同一枚珊瑚轮廓资产（同一份 base64，裁到轮廓），
  * ZCodeStartupLogoBadge 改为静态标记，删掉 animate-pulse 与 animated prop。
  * 新增 AppSettings.disableStartupAnimation（默认 false）+ 设置页开关；
  * Linux deep link 条目 id 改为 zcodium.desktop（与包名同名，系统级条目抑制才生效），
  * runtimeApplicationName 从硬编码 ZCode 改为构建期产品身份（ZCodium/Dev/Preview），
  * 补充 desktop-product-identity.d.mts，修掉 main 工程里既有的 TS7016。

* **privacy:** keep HTTP execution trace identifiers local ([d480065](https://github.com/axiom-desu/ZCodium/commit/d4800659bc82f79cf6b70d8749e9e8ac5a332e91))

* **privacy:** remove device fingerprints and automatic identity headers ([e12aeeb](https://github.com/axiom-desu/ZCodium/commit/e12aeeb6ec8a4110380cbd13f4af51a8f2e1c7bc))

* **privacy:** remove implicit model client metadata headers ([6e44552](https://github.com/axiom-desu/ZCodium/commit/6e44552a7f059e7a702a63a168c6402609ec7517))

* **settings:** remove the dead "disable startup animation" setting 6fbede0 left behind ([d201c0f](https://github.com/axiom-desu/ZCodium/commit/d201c0ff89172e1db72e42ee7674c6045cc4fc84))
  * protocol.ts / validationAppSettings.ts / test-ids.ts：删字段与 schema。
  * SettingsPage / settingsPageHelpers：删状态、handler、UI 开关与 props。
  * useSettingService：删 localStorage 镜像写入；删除 startupAnimationPreference.ts。
  * en-US / zh-CN：删 i18n key。

* **test:** advance maintenance sampler clock with fake timers ([8385873](https://github.com/axiom-desu/ZCodium/commit/83858737bd55cedd32681079f9bbb684256a5d3f))

* **ui:** bundle recommendation icons and retire idle task prompts ([d1f1200](https://github.com/axiom-desu/ZCodium/commit/d1f120048b7fd14e409e5ef095c05f2ee80428dd))

* **ui:** fade the draft watermark out above the composer ([b406b83](https://github.com/axiom-desu/ZCodium/commit/b406b839b2cc6c9077b67647152b41d31130712e))

* **ui:** finish the ZCodium rebrand in the chrome, About window and empty state ([2f63249](https://github.com/axiom-desu/ZCodium/commit/2f63249e0187c9a144c7177fb42d7a7ded0360f7))

* **ui:** keep message layer mask from leaking into draft empty state ([5c153a8](https://github.com/axiom-desu/ZCodium/commit/5c153a80b131dba322dbbdd65b67f40a1d0954ba))

* **ui:** point the no-model error at custom model setup ([1933645](https://github.com/axiom-desu/ZCodium/commit/1933645dd21b47d9192da03788b72176d40c3b9f))

* **ui:** render draft watermark as inline SVG ([09c7e1a](https://github.com/axiom-desu/ZCodium/commit/09c7e1a79cb8ac8692f9879d3437ae4a66b35630))

* **ui:** replace the remaining inline Z logos with the ZCodium icon ([4e06dd8](https://github.com/axiom-desu/ZCodium/commit/4e06dd85931241c586262ca600dce599b7d06d6f))
  * RootStartupLoading.tsx：ZCodeStartupLogo 的 3 段 path SVG 改为 <img>。
  * ZCodeAboutLogo.tsx：同样改为 <img>，并删除 ZCodeWordmarkLogo——
  * ConversationDraftEmptyState.tsx：原实现分两套资产，浅色 currentColor

* **ui:** replace the remaining inline Z logos with the ZCodium icon ([d550b0b](https://github.com/axiom-desu/ZCodium/commit/d550b0b20358afd473352e219f5efec8a6ad4e9e))
  * RootStartupLoading.tsx：ZCodeStartupLogo 的 3 段 path SVG 改为
  * ZCodeAboutLogo.tsx：同样改为 <img>。顺带删除 ZCodeWordmarkLogo——
  * ConversationDraftEmptyState.tsx：原实现分两套资产，浅色 currentColor

* **zcode-cua:** Wayland 会话自动启用 cua-driver Wayland 窗口后端 ([54f7315](https://github.com/axiom-desu/ZCodium/commit/54f7315dedbfacb634bbb3e5857d88df7222062a))

* **zcode-cua:** 兼容层 Unicode 文本改用 Ctrl+Shift+U 码点，去掉剪贴板 ([269b24a](https://github.com/axiom-desu/ZCodium/commit/269b24ae5cafb69ef33ab280f2624f960d5efe76))
  * `backend.js` 新增 `typeUnicode`：Ctrl+Shift+U → 十六进制码点逐位 → Enter，
  * `executor.js` 非 ASCII 走 `backend.typeUnicode`，删除 child_process 依赖。
  * spec §6.4/§7.2/§9/§10 更新文本分级与验证记录（含 calc "5"、gedit 三级）。
  * 单测 70/70；真实 gedit 三级下发成功（keycode/keycode/codepoint）。


### Chores

* **cua:** 删除 Computer Use Helper build-id 死机器 ([8643606](https://github.com/axiom-desu/ZCodium/commit/86436068ba3a21250bf51a550016f46564251639))

* **deps:** stage1 sync pnpm-lock.yaml with the current workspace ([b68f388](https://github.com/axiom-desu/ZCodium/commit/b68f388edd496eaf8d8dc6d5ade8c990f427410a))
  * apps/zcode-cli/packages/android-emulator-plugin
  * apps/zcode-cli/packages/ios-simulator-plugin
  * apps/zcode-cli/packages/superpowers-plugin
  * packages/desk-pilot
  * 从 HEAD 的 lockfile 重新执行 `pnpm install --lockfile-only`，产物与本次提交逐字节一致
  * `pnpm install --frozen-lockfile` exit 0，且不会再次改写 lockfile
  * `pnpm typecheck` exit 0

* **diagnostics:** finalize dependency cleanup and change report ([78ab75e](https://github.com/axiom-desu/ZCodium/commit/78ab75e8935174b4aac815abcc3fc5e149cc4d8b))

* release v3.14.3-1 ([db54813](https://github.com/axiom-desu/ZCodium/commit/db54813c31dce1a04a766e2810afd10ae6f5f1f9))

* release v3.14.3-1 ([591fc55](https://github.com/axiom-desu/ZCodium/commit/591fc55d99285da353b0411eb364b927967429a3))

* release v3.14.3-1 ([fd33e87](https://github.com/axiom-desu/ZCodium/commit/fd33e87367e44edb61fe34a7bd0fa035653164e6))

* release v3.15.0 ([a179b34](https://github.com/axiom-desu/ZCodium/commit/a179b3401c9c062db60e3b7fcf44550889fd244f))

* 归档官方上游构建到 official-builds/ 并忽略 ([5ed8f9b](https://github.com/axiom-desu/ZCodium/commit/5ed8f9bfb5e9b3977cfd4b9c7a8c44ae16c081a7))

* 忽略误落仓库根的 /favicon.svg ([2e9b15b](https://github.com/axiom-desu/ZCodium/commit/2e9b15b6f910b095a404c8948a0874aac30a7777))


### Documentation

* add a Chinese/English switch to the landing page ([fdb1f03](https://github.com/axiom-desu/ZCodium/commit/fdb1f036a3f0b1edea71d5d718fadeb5627eaa45))

* add Liang Wenfeng quote on open source to the README header ([bb5c7db](https://github.com/axiom-desu/ZCodium/commit/bb5c7db457745edb215d6264b68640f57d40c94f))

* add spec for a generic cross-platform Computer Use runtime ([3dd6bf4](https://github.com/axiom-desu/ZCodium/commit/3dd6bf4320bf9b41bca88a6d5cd5f3b63d77223b))
  * Helper 是 Contents/Resources/cua-helper/ZCode Computer Use.app，
  * 截图走 shell：screencapture -x -t png [-R<x,y,w,h>] <out>；
  * 输入原语：mouseDownToWindow / clickToWindow / scrollToWindow /
  * 权限模型：Accessibility + Screen Recording 两项系统授权
  * SDK 模块结构：dist/index.js + dist/broker/server/{helperLauncher,
  * 新增 Actuator 接口作为平台相关能力的唯一收敛点，14 个方法在其上
  * 平台能力矩阵如实标注：Wayland 下 pointer/keyboard 为 false，
  * 保留 possibly_sent 语义（动作失败时标记是否可能已下发）与
  * 输入经统一 command runner，集中处理超时、退出码、输出上限；

* add the GitHub Pages landing site ([9379e9c](https://github.com/axiom-desu/ZCodium/commit/9379e9c2fb4aaa89e2a3f862ff48b10d50d498be))

* disambiguate the footer README links ([3113b44](https://github.com/axiom-desu/ZCodium/commit/3113b4411f9909835553c11dd1e7635cace418ab))

* link the AstrBot bridge plugin from the roadmap entry ([67fcd07](https://github.com/axiom-desu/ZCodium/commit/67fcd07c301813cd93f9c8e65e2a1d5d8d586ba2))

* mirror the README link language between locales ([64f4812](https://github.com/axiom-desu/ZCodium/commit/64f48127837d4e8995cfda194fc5928cf592af4e))

* point the README link at the reader's other language ([741881d](https://github.com/axiom-desu/ZCodium/commit/741881d82c17a63e44022949570fb6b820599d4f))

* **readme:** 按官方 3.14.3 安装包重新核对 i18n 键缺口 ([fe854c6](https://github.com/axiom-desu/ZCodium/commit/fe854c6f640752079c8a751246b39803f4eb6fcd))
  * 解出 resources/app.asar，取 out/renderer/assets/IntlProvider-*.js
  * 结果：官方 6126 键、仓库 5901 键，缺口 258 键（此前写 528），
  * bots 的 259 键已由上游 3.14.3 全部开源，缺口归零。
  * webRemoteControl 只进来 botChannel 渠道选择一层（15 键，另含
  * 补上旧表遗漏的 marketingTouch / taskList / chat / remote /
  * 核对方法写进 README，下次升级不用重新摸索。

* **readme:** 记录合并上游 3.14.3 与官方 bots/AstrBot 并存路线 ([7f387ce](https://github.com/axiom-desu/ZCodium/commit/7f387cef95a83a447b9e97e6a63aaf7426acc151))

* rebrand README to ZCodium and document the backfill workflow ([66d716b](https://github.com/axiom-desu/ZCodium/commit/66d716bd7a25d7cf94a37961c30f1c88813480af))
  * 已补全：9 个内置插件 + Computer Use 的 client/skill/docs
  * 未补全：528 个 i18n 键缺口，主要是 bots(258)、webRemoteControl(104)、
  * 有意不补：repo snapshot 上传（隐私风险，仅保留 localhost 审计复现）、

* rebuild the landing page in an Apple × Tracebit style ([8d645d0](https://github.com/axiom-desu/ZCodium/commit/8d645d0a43962fa3011d69ff1e4806ffdaf4c74b))

* record the Computer Use execution-chain layer audit ([63012b0](https://github.com/axiom-desu/ZCodium/commit/63012b0474b9bbe4a80a93366443fbe642cb64a9))

* record the open-source bases for the content plugins ([c638d26](https://github.com/axiom-desu/ZCodium/commit/c638d268644b7191b85b5890a0b33e1f6d754ffe))

* refine the landing page hero and header ([97c2660](https://github.com/axiom-desu/ZCodium/commit/97c2660b1fbfbdf1871c2c3283619642911e368b))
  * 顶栏只保留橙色 GitHub 按钮，移除重复的文字链接
  * Hero 补一句 ZCodium 介绍，与「补回源码」连成一句
  * 署名后加入「我们深有感触，于是有了 ZCodium」，并补齐中英文案

* **spec:** 定 Linux 常驻形态为随 app 的私有 daemon，不用 systemd user ([d2b3cd2](https://github.com/axiom-desu/ZCodium/commit/d2b3cd2de377c98326821c11a06a547d1ded80b4))

* **spec:** 新增 Computer Use 架构总览 ([5c27a8d](https://github.com/axiom-desu/ZCodium/commit/5c27a8d6853bbda78624f1fd1298130a773acec0))

* state the backfill rule as "implement an equivalent version" ([0a955c3](https://github.com/axiom-desu/ZCodium/commit/0a955c3844bad54ffb1e06554d97526b024796b0))

* use the README.en quote translation on the English page ([d4bcfe9](https://github.com/axiom-desu/ZCodium/commit/d4bcfe9b0b97a18e279282b6cf4b175d127c2165))

* **zcode-cua:** capabilities spec M1–M5 状态更新 ([ddf1d8c](https://github.com/axiom-desu/ZCodium/commit/ddf1d8cc17c231bcdb7ae58e2bbbac967cb357fb))

* 更新 README 并把根版本标为 3.14.3-modified ([f06a50e](https://github.com/axiom-desu/ZCodium/commit/f06a50eea2888d4cfdc5640d31bface9cb035849))
  * README.md / README.en.md：Computer Use 改为复用 @trycua/cua-driver、
  * 根 package.json：version 3.14.0 → 3.14.3-modified，用于区分本仓库产物。


### Refactorings

* **agent:** retire idle execution context and ticket input ([a4bce74](https://github.com/axiom-desu/ZCodium/commit/a4bce740107939ccd91f7416496121a165414bec))

* **agent:** retire official idle-time task tools and protocol ([25759df](https://github.com/axiom-desu/ZCodium/commit/25759dfc13c1bbb7b94357bf30a217a9bc345be8))

* **auth:** delete unused official entitlement and token clients ([f9259c7](https://github.com/axiom-desu/ZCodium/commit/f9259c7b6b2b094c5a5d6e24606b000b0ac1015d))

* **auth:** remove Host OAuth and account-scoped onboarding ([38d1f4f](https://github.com/axiom-desu/ZCodium/commit/38d1f4fb1e8bf724167d43d573670e0b14a0d63c))

* **automations:** remove official idle task UI and polling ([26c5159](https://github.com/axiom-desu/ZCodium/commit/26c51594a795075d5d9f6fb1112e303c5746f2b6))

* **automations:** retire official idle task services and dispatch ([2fc3aeb](https://github.com/axiom-desu/ZCodium/commit/2fc3aebfb8c21ff243604fe9c4686e020a781989))

* **billing:** remove enterprise pricing and project key acquisition ([eb26b5b](https://github.com/axiom-desu/ZCodium/commit/eb26b5b0ccce1a336b0ff49d03adc75bc7e8e76e))

* **billing:** remove official purchase flows ([c31f7e9](https://github.com/axiom-desu/ZCodium/commit/c31f7e97114b277c3c9904e7c81ff45b5ee555c1))

* **cli:** drop the dead MIT-base header from the docx scripts ([b2cbf9a](https://github.com/axiom-desu/ZCodium/commit/b2cbf9aa2fbaf23a12fc107161378a9a02deb3f0))

* **cli:** remove account model lifecycle and Host overlay sync ([38d101b](https://github.com/axiom-desu/ZCodium/commit/38d101bf07a6a1e89a35c3ecdc3be8d26b51224f))

* **cli:** remove official login flows and guide local model setup ([18de1b4](https://github.com/axiom-desu/ZCodium/commit/18de1b4efa830a1af5463e49f8a33defa689f1f3))

* **cli:** remove proprietary login credential storage ([6384739](https://github.com/axiom-desu/ZCodium/commit/6384739bba11c4e1a8eb351f88b345529d53b640))

* **cli:** remove proprietary telemetry and retain safe diagnostics ([6480369](https://github.com/axiom-desu/ZCodium/commit/6480369516bd19ff4151e7e7e5f69546177cf56e))

* **cli:** rewrite the plugin doc layers from their implementations ([21918a5](https://github.com/axiom-desu/ZCodium/commit/21918a5bb89d21c8414f261f193cf827a04bf483))

* **cli:** split the 1356-line docx document.py into six modules ([838592a](https://github.com/axiom-desu/ZCodium/commit/838592af84768f53b0df3933afde3f08538a17cb))

* **composer:** remove official quota services from context display ([92d4888](https://github.com/axiom-desu/ZCodium/commit/92d4888aab4a8a33b6dc99d43ed664ad6c1e5319))

* **cua:** 拆除闭源 Computer Use Helper 整条链 ([9976f24](https://github.com/axiom-desu/ZCodium/commit/9976f24c58df7b1f1def68af36b579c793255d69))
  * packages/zcode-cua 的 broker*/pip-session* 共 16 个文件与 8 条 exports；
  * services 的 cuaHelperInstaller / cuaPipSession / cuaPipSessionService；
  * desktop 的 cuaAccessibilitySettings / desktopCuaHelperInstaller / cuaPipFocusRouter /
  * node.ts 里 createDefaultCuaProductHelper 的 darwin 分支、resolveBundledCuaHelperAppPath、
  * shared 的 CuaPipSession、CuaPipFocusChanged 通道、hostCuaPipFocusChangedMessageSchema
  * markCuaProductHelperAgentEnvUnavailable 一族（原是 no-op stub，has... 恒 false，

* **debug:** remove live capture and retain offline inspection ([a6d5022](https://github.com/axiom-desu/ZCodium/commit/a6d5022fa76cd122cf767165af8efb494eeac782))

* **desktop:** remove official OAuth callbacks and IPC ([9100c25](https://github.com/axiom-desu/ZCodium/commit/9100c25077255bf6106f6bc08cbbb9419823f661))

* **desktop:** replace reporting with safe local diagnostics ([619f714](https://github.com/axiom-desu/ZCodium/commit/619f714059367a4bbe40ca857501e5652417a749))

* **host:** remove official account model lifecycle ([12c3292](https://github.com/axiom-desu/ZCodium/commit/12c3292095acdb6a8abbd72819476c969f96f63e))

* **host:** remove official MCP credential issuance and quota requests ([87058ee](https://github.com/axiom-desu/ZCodium/commit/87058eee13aa2efd1d8f3e29c51cbc9bf9df6cad))

* **host:** remove official request credential services ([492f75c](https://github.com/axiom-desu/ZCodium/commit/492f75c2f861e347b9c9e9efaad008c683828edc))

* **model:** remove Host account authentication and request attribution ([1954e3b](https://github.com/axiom-desu/ZCodium/commit/1954e3bcd3e9e31c31276675b29e9fd966e92325))

* **models:** remove account flows from model settings ([968a868](https://github.com/axiom-desu/ZCodium/commit/968a868b8743c58a3fed8ca3ef5c9e6eb9266da6))

* **models:** remove official ticket auth and idle queue retries ([7b23d29](https://github.com/axiom-desu/ZCodium/commit/7b23d29be914a210e5b160922c2ce0236e27eb26))

* **node-repl-host:** cua-driver 运行时不再把闭源 Helper broker socket 当 driver endpoint ([279d710](https://github.com/axiom-desu/ZCodium/commit/279d7100b094ef937bd59b201b2b58912958f1da))

* **provisioning:** sync personal models without official credentials ([52b62e1](https://github.com/axiom-desu/ZCodium/commit/52b62e106e7d653a70f01d412c4f73050fb30de0))

* rename the .zcode data namespace to .zcodium ([f12f4ea](https://github.com/axiom-desu/ZCodium/commit/f12f4ea3482a5913c1973fceb8e95a8d5fb525c4))

* **services:** Computer Use 权限状态改由 cua-driver 提供 ([650f2ff](https://github.com/axiom-desu/ZCodium/commit/650f2ff024598bda707144f0abf7812a3cc7085d))

* **session:** remove official quota banners and preserve error diagnostics ([ec1a287](https://github.com/axiom-desu/ZCodium/commit/ec1a287a87d813fe2e6827872108a9cf1db032ee))

* **startup:** remove official account restoration ([1c07c42](https://github.com/axiom-desu/ZCodium/commit/1c07c42c0bb5832e9a43db157e0916f24a3c013e))

* **ui:** Computer Use 设置页权限操作改走 cua-driver ([1056d87](https://github.com/axiom-desu/ZCodium/commit/1056d87e6d70f09d9297beb8abb0c1a136c7b9a6))

* **ui:** preserve performance diagnostics without behavior tracking ([7811966](https://github.com/axiom-desu/ZCodium/commit/7811966f355d7cdc95b1630127a4d35ed7ff990e))

* **ui:** remove official plan recommendations from model submission ([cf003a1](https://github.com/axiom-desu/ZCodium/commit/cf003a1698f1a6363a2a8b9d47dfa89dec75043b))

* **ui:** replace account menus with local preferences ([44c5730](https://github.com/axiom-desu/ZCodium/commit/44c573063e6ce3c6580c2033aa2162242de2df9b))

* **ui:** 运行中 CUA 权限提示改走 cua-driver，删返回恢复机制 ([4932785](https://github.com/axiom-desu/ZCodium/commit/4932785755c4cb9a7287a9282fb5affcd0248ff7))

* **usage:** keep statistics local and remove official plan views ([d35ef07](https://github.com/axiom-desu/ZCodium/commit/d35ef07f34a2b70952dd277a42a37546577fa2a6))

* **usage:** remove official quota services and retired plan UI ([01c72b2](https://github.com/axiom-desu/ZCodium/commit/01c72b2f18995192c671562b4a5908ac037f70c9))

* **web:** remove official OAuth and callback exchange ([6924329](https://github.com/axiom-desu/ZCodium/commit/6924329611a7d760c57718dd5e209f223937add3))


### Other Changes

* fix(auto-update)：让 fork 拥有自己的更新源，并把更新缓存与官方隔离 ([#8](https://github.com/axiom-desu/ZCodium/issues/8)) ([a5d8744](https://github.com/axiom-desu/ZCodium/commit/a5d8744b269e6f20475f5fd5ca24e044cbe03294))
  * fix(auto-update): own the update source and isolate the update cache
  * initAutoUpdater 不配置 provider、不轮询，直接返回；
  * force-update gate 直接放行，不读上游配置。
  * fix(desktop): isolate updater cache dir from upstream ZCode

* Initial commit ([77432b6](https://github.com/axiom-desu/ZCodium/commit/77432b6dbf9f70176ced3f4dcdc25f851c3acb2d))
