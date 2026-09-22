import { ZCODE_OFFICIAL_PLUGIN_MARKETPLACE } from "@zcode/contracts";

// 内置插件的商店信息 seed（原样写入官方 marketplace.json 的条目 raw，键名与 CDN 目录
// schema 一致：displayName_i18n / examplePrompts_i18n 等），解析复用 adapter 的
// parseEntryStoreListing。icon 指向官方 assets CDN；请求失败时 UI 会安全降级为默认图标。
export interface OfficialPluginListingSeed {
  displayName?: string;
  displayName_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  category?: string;
  author?: { name: string; url?: string };
  icon?: string;
  homepage?: string;
  privacyPolicy?: string;
  termsOfService?: string;
  heroImage?: string;
  examplePrompts?: string[];
  examplePrompts_i18n?: Record<string, string[]>;
}

const OFFICIAL_BROWSER_USE_PLUGIN_NAME = "browser-use";
export const OFFICIAL_BROWSER_USE_PLUGIN_ID = `${OFFICIAL_BROWSER_USE_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;
/**
 * node_repl 宿主。它不是面向用户的插件：没有 skill、没有 listing、不进市场，唯一职责是
 * 携带 `dist/mcp/server.js` 这个 Browser Use 与 Computer Use 共用的运行时产物。
 *
 * 为什么它需要成为一个 seed 单元：宿主产物过去长在 browser-use 包里，于是
 * resolveBuiltInNodeReplMcpServers 只能在 browser-use 的 rootPath 下找它 —— browser-use
 * 包缺失时，即便 Computer Use 自己启用也拿不到宿主。做成独立 seed 单元后，两个插件
 * 各自只贡献自己的领域资产，谁启用都能拿到同一个宿主。
 */
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME = "node-repl-host";
export const OFFICIAL_NODE_REPL_HOST_PLUGIN_ID = `${OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;
const OFFICIAL_CUA_PLUGIN_NAME = "computer-use";
export const OFFICIAL_CUA_PLUGIN_ID = `${OFFICIAL_CUA_PLUGIN_NAME}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`;

export interface OfficialPluginDefinition {
  // 内容型 plugin (无 MCP server / 无系统依赖) 可以设为 true,
  // 这样用户首次 `/skill <name>` 就能用,不必先 `zcode plugins enable`。
  // 默认 false 保持 ios-simulator / android-emulator 这类重负载 plugin 原来行为。
  defaultEnabled?: boolean;
  listing?: OfficialPluginListingSeed;
  /**
   * 由宿主为该官方插件提供、但不属于 plugin manifest 的 MCP server。
   * 仅用于产品归属和设置页状态展示；运行时仍保留宿主 identity。
   */
  hostMcpServerNames?: readonly string[];
  name: string;
  /** filesystem/SEA seed 缺少任一项时拒绝生成残缺的官方插件缓存。 */
  requiredSeedPaths?: readonly string[];
  rootCandidates: readonly string[];
  /** Extra top-level paths intentionally staged as plugin runtime assets. */
  runtimeTopLevelPaths?: readonly string[];
  version: string;
}

const ZAI_AUTHOR = { name: "Z.ai", url: "https://z.ai" } as const;
const OFFICIAL_PLUGIN_ASSETS_BASE_URL = "https://cdn-zcode.z.ai/zcode/official-plugin/assets";

const OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS = ["dist/mcp/server.js"] as const;

export const OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS = [
  "docs/api.json",
  "docs/documents.json",
  "docs/overview.md",
  // documents.json 已注册 recording lookup；若不强制校验正文，会 seed 出无法读取录屏指南的残缺插件。
  "docs/recording.md",
  "docs/workflow.md",
  "scripts/browser-client.mjs",
  "skills/control-browser/SKILL.md",
  "skills/web-gui-tester/SKILL.md",
]

export const OFFICIAL_PDF_REQUIRED_SEED_PATHS = [
  // 三个 brief 是 SKILL.md 路由表的目的地；scripts/ 是渲染与表单能力的执行体，
  // convert_pdf_to_images.py 同时是 visual-judge 工作流的渲染门。缺任一项都会装出
  // 「看得见技能、调不到脚本」的残缺插件。
  "agents/visual-judge.md",
  "skills/pdf/SKILL.md",
  "skills/pdf/briefs/report.md",
  "skills/pdf/briefs/resume.md",
  "skills/pdf/briefs/poster.md",
  "skills/pdf/scripts/convert_pdf_to_images.py",
  "skills/pdf/scripts/create_validation_image.py",
  "skills/pdf/scripts/check_fillable_fields.py",
  "skills/pdf/scripts/extract_form_field_info.py",
  "skills/pdf/scripts/fill_fillable_fields.py",
  "skills/pdf/scripts/fill_pdf_form_with_annotations.py",
  "skills/pdf/scripts/check_bounding_boxes.py",
  "skills/pdf/scripts/check_bounding_boxes_test.py",
  // pdf_qa 家族是质量门，五个模块互相导入；只 seed pdf_qa.py 会让门在首次 import 就死。
  "skills/pdf/scripts/pdf_qa.py",
  "skills/pdf/scripts/pdf_qa_document.py",
  "skills/pdf/scripts/pdf_qa_text.py",
  "skills/pdf/scripts/pdf_qa_checks.py",
  "skills/pdf/scripts/pdf_qa_colors.py",
] as const;

export const OFFICIAL_DOCUMENTS_REQUIRED_SEED_PATHS = [
  // 脚本与模板是技能正文描述的能力的执行体；routes/references 是 SKILL.md 的下一步
  // 阅读路径。缺任一项都会装出「看得见技能、读不到参考」的残缺插件。
  "agents/visual-judge.md",
  "skills/docx/SKILL.md",
  "skills/docx/scripts/__init__.py",
  "skills/docx/scripts/document.py",
  "skills/docx/scripts/utilities.py",
  "skills/docx/scripts/packing.py",
  "skills/docx/scripts/identifiers.py",
  "skills/docx/scripts/docx_editor.py",
  "skills/docx/scripts/tracked_changes.py",
  "skills/docx/scripts/comments.py",
  "skills/docx/scripts/postcheck.py",
  "skills/docx/scripts/postcheck_document.py",
  "skills/docx/scripts/postcheck_rules.py",
  "skills/docx/scripts/fix_footer_fields.py",
  "skills/docx/scripts/add_toc_placeholders.py",
  "skills/docx/scripts/templates/comments.xml",
  "skills/docx/scripts/templates/commentsExtended.xml",
  "skills/docx/scripts/templates/commentsExtensible.xml",
  "skills/docx/scripts/templates/commentsIds.xml",
  "skills/docx/scripts/templates/people.xml",
  "skills/docx/setup.sh",
  "skills/docx/routes/create.md",
  "skills/docx/routes/read.md",
  "skills/docx/routes/comment.md",
  "skills/docx/routes/edit.md",
  "skills/docx/routes/format.md",
  "skills/docx/references/python-api.md",
  "skills/docx/references/toc.md",
  "skills/docx/env_setup/setup.md",
  "skills/docx/env_setup/env_check.sh",
] as const;

const OFFICIAL_CUA_REQUIRED_SEED_PATHS = [
  "docs/computer-use.md",
  // SDK 入口及其四个依赖模块。entry 单独 import 它们，少任何一个都会得到
  // 一个看得见 computer-use 却在第一次调用时 ERR_MODULE_NOT_FOUND 的插件。
  "scripts/computer-use-client.mjs",
  "scripts/computer-use-errors.mjs",
  "scripts/computer-use-envelope.mjs",
  "scripts/computer-use-keys.mjs",
  "scripts/computer-use-target.mjs",
  "skills/computer-use/SKILL.md",
] as const;

// zcode-guide 原本没有 requiredSeedPaths，seed 丢文件时会静默装出一个
// 没有 /workflow 命令的插件——症状是命令不存在，没有任何诊断。commands/ 与技能正文都钉住。
const OFFICIAL_ZCODE_GUIDE_REQUIRED_SEED_PATHS = [
  "commands/workflow.md",
  "skills/dynamic-workflows/SKILL.md",
  "skills/dynamic-workflows/examples.md",
  "skills/dynamic-workflows/patterns.md",
] as const;

export const OFFICIAL_PLUGIN_DEFINITIONS: readonly OfficialPluginDefinition[] = [
  {
    // 无 listing：宿主不进市场、不对用户露出。它必须始终可用，因为 node_repl 的注册门禁
    // 是「Browser Use 或 Computer Use 任一启用」，宿主自己不参与那个判断。
    //
    // 这里的 defaultEnabled 不违反「仅限内容型插件」那条约定（见下方 computer-use 的说明）：
    // 约定要防的是「首启即注入整套工具集并拉起 Helper」，而 seed 宿主两件都不做——工具是否
    // 进模型工具池由两个能力插件的启停决定，Helper 由 SDK 首次调用时才拉起。
    defaultEnabled: true,
    name: OFFICIAL_NODE_REPL_HOST_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_NODE_REPL_HOST_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/node-repl-host",
      "../node-repl-host",
      "../../node-repl-host",
      "../../../node-repl-host",
    ],
    version: "0.6.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "Android Emulator",
      displayName_i18n: { "zh-CN": "Android 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/android-emulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 Android 开发工作流与模拟器自动化能力。",
      },
    },
    name: "android-emulator",
    rootCandidates: [
      "packages/android-emulator-plugin",
      "../android-emulator-plugin",
      "../../android-emulator-plugin",
      "../../../android-emulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // manifest 只声明 browser-use skill；宿主 node_repl MCP 独立注入，package 另外携带其 server/client
    // runtime 资产。默认启用仅控制「何时/如何用内置浏览器」的 skill 与 browser bridge。
    defaultEnabled: true,
    hostMcpServerNames: ["node_repl"],
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Browser Use",
      displayName_i18n: { "zh-CN": "浏览器操作" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/browser-use/icon.png`,
      description_i18n: {
        "zh-CN": "操作 ZCode 内置浏览器，检查网页并验证交互。",
      },
    },
    name: OFFICIAL_BROWSER_USE_PLUGIN_NAME,
    requiredSeedPaths: OFFICIAL_BROWSER_USE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/browser-use-plugin",
      "../browser-use-plugin",
      "../../browser-use-plugin",
      "../../../browser-use-plugin",
    ],
    // 插件 package/manifest 升版时遗漏官方 seed 版本，会继续加载旧缓存目录。
    // package、manifest、definition 三处版本应保持一致，避免发布内容和安装版本再次分叉。
    version: "0.5.1",
  },
  ...(
    [
      // seed 注册与发行清单一致，资源完整性仍由 requiredSeedPaths 严格校验。
      // version 与各自 package.json / plugin.json 逐字一致：三处不一致会让官方 seed
      // 继续加载旧缓存目录（见上方 browser-use 的同类注释）。
      ["presentations", "pptx", "Presentations", "演示文档", "0.1.7"],
      ["documents", "docx", "Documents", "Word 文档", "0.1.7"],
      ["pdf", "pdf", "PDF", "PDF 文档", "0.2.0"],
      ["spreadsheets", "xlsx", "Spreadsheets", "电子表格", "0.1.7"],
    ] as const
  ).map(
    ([name, skill, displayName, chineseName, version]): OfficialPluginDefinition => ({
      defaultEnabled: true,
      listing: {
        author: ZAI_AUTHOR,
        category: "productivity",
        displayName,
        displayName_i18n: { "zh-CN": chineseName },
        // 复用已发布的文档图标，拆分插件无需依赖新 CDN 资源。
        icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/document-skills/icon.png`,
        description_i18n: { "zh-CN": `创建、编辑与审阅${chineseName}（${skill.toUpperCase()}）。` },
      },
      name,
      // documents 的 Python 脚本是技能正文描述的全部能力的执行体；只列两个 markdown
      // 能让校验通过，却挡不住拷贝被截断，最终装出看得见 docx 技能却 import 不到
      // document.py 的残缺插件。与 OFFICIAL_CUA_REQUIRED_SEED_PATHS 扩项同理。
      requiredSeedPaths:
        name === "documents"
          ? OFFICIAL_DOCUMENTS_REQUIRED_SEED_PATHS
          : // pdf 的 Phase 1 只有技能与三个 brief，没有 scripts/。brief 是 SKILL.md
            // 路由表的目的地，缺任一即"看得见技能、读不到 brief"；scripts 落地后必须
            // 同步扩项，否则会装出技能描述了却调不到的残缺插件。
            name === "pdf"
            ? OFFICIAL_PDF_REQUIRED_SEED_PATHS
            : // recalc.py 是 SKILL.md「Recalculating formulas」章节的唯一执行体，
            // openpyxl 读取与 soffice 重算都走它；漏掉就是看得见技能、调不到脚本。
            name === "spreadsheets"
            ? [
                "agents/visual-judge.md",
                "skills/xlsx/SKILL.md",
                "skills/xlsx/scripts/recalc.py",
              ]
            : ["agents/visual-judge.md", `skills/${skill}/SKILL.md`],
      rootCandidates: [
        `packages/${name}-plugin`,
        `../${name}-plugin`,
        `../../${name}-plugin`,
        `../../../${name}-plugin`,
      ],
      version,
    }),
  ),
  {
    // 沿用原聚合文档插件的官方搜图能力，仅拆出独立开关；认证仍由官方 MCP adapter 注入。
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Image Search",
      displayName_i18n: { "zh-CN": "搜图" },
      description_i18n: { "zh-CN": "查找插图与参考配图。" },
    },
    name: "image-search",
    requiredSeedPaths: [".mcp.json"],
    rootCandidates: [
      "packages/image-search-plugin",
      "../image-search-plugin",
      "../../image-search-plugin",
      "../../../image-search-plugin",
    ],
    version: "0.1.1",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "developer-tools",
      displayName: "iOS Simulator",
      displayName_i18n: { "zh-CN": "iOS 模拟器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/ios-simulator/icon.png`,
      description_i18n: {
        "zh-CN": "提供 iOS 开发工作流与模拟器自动化能力。",
      },
    },
    name: "ios-simulator",
    rootCandidates: [
      "packages/ios-simulator-plugin",
      "../ios-simulator-plugin",
      "../../ios-simulator-plugin",
      "../../../ios-simulator-plugin",
    ],
    version: "0.1.0",
  },
  {
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Restore Legacy Sessions",
      displayName_i18n: { "zh-CN": "恢复旧版会话" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/restore-legacy-sessions/icon.png`,
      description_i18n: {
        "zh-CN": "将旧版会话恢复为 ZCode 任务与会话记录。",
      },
    },
    name: "restore-legacy-sessions",
    rootCandidates: [
      "packages/restore-legacy-sessions-plugin",
      "../restore-legacy-sessions-plugin",
      "../../restore-legacy-sessions-plugin",
      "../../../restore-legacy-sessions-plugin",
    ],
    version: "0.1.0",
  },
  {
    defaultEnabled: true,
    name: "plugin-creator",
    version: "0.1.1",
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Plugin Creator",
      // 创建器使用客户端自带图标，不再借用 skill-creator 的远端图片。
      displayName_i18n: { "zh-CN": "插件创建器" },
      description_i18n: {
        "zh-CN": "开发、校验 ZCode 插件，完成本地 dev 市场安装、试用与更新。",
      },
    },
    rootCandidates: [
      "packages/plugin-creator-plugin",
      "../plugin-creator-plugin",
      "../../plugin-creator-plugin",
      "../../../plugin-creator-plugin",
    ],
    requiredSeedPaths: [
      "skills/plugin-creator/SKILL.md",
      "skills/plugin-creator/scripts/create-basic-plugin.mjs",
      "skills/plugin-creator/scripts/marketplace-files.mjs",
      "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
      "skills/plugin-creator/scripts/scaffold-files.mjs",
      "skills/plugin-creator/scripts/validate-plugin.mjs",
      "skills/plugin-creator/references/plugin-json-spec.md",
      "skills/plugin-creator/references/installing-and-updating.md",
    ],
  },
  {
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "Skill Creator",
      displayName_i18n: { "zh-CN": "技能创建器" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/skill-creator/icon.png`,
      description_i18n: { "zh-CN": "创建、编辑和验证可复用的 ZCode 技能。" },
    },
    name: "skill-creator",
    rootCandidates: [
      "packages/skill-creator-plugin",
      "../skill-creator-plugin",
      "../../skill-creator-plugin",
      "../../../skill-creator-plugin",
    ],
    version: "0.1.0",
  },
  {
    // 纯内容型插件（只有 commands + skills，无 MCP / 无系统依赖），默认启用，
    // 让用户/agent 开箱即用地拿到 ZCode 配置指南、自诊断技能与 dynamic workflow 编写指南。
    defaultEnabled: true,
    listing: {
      author: ZAI_AUTHOR,
      category: "utilities",
      displayName: "ZCode Guide",
      displayName_i18n: { "zh-CN": "ZCode 使用指南" },
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/zcode-guide/icon.png`,
      description_i18n: {
        "zh-CN": "提供 ZCode 配置指南与插件、技能、MCP、命令和钩子诊断。",
      },
      examplePrompts: [
        "How do I configure MCP servers in ZCode?",
        "Diagnose my current ZCode setup",
      ],
      examplePrompts_i18n: {
        "zh-CN": ["ZCode 里怎么配置 MCP 服务器？", "帮我诊断当前的 ZCode 配置"],
      },
    },
    name: "zcode-guide",
    requiredSeedPaths: OFFICIAL_ZCODE_GUIDE_REQUIRED_SEED_PATHS,
    rootCandidates: [
      "packages/zcode-guide-plugin",
      "../zcode-guide-plugin",
      "../../zcode-guide-plugin",
      "../../../zcode-guide-plugin",
    ],
    version: "0.2.0",
  },
  {
    // 产品决策：电脑控制回退为默认关闭，需用户在设置页显式开启。
    // 因此这里不声明 defaultEnabled——computer-use 携带 MCP server 与系统 Helper 依赖，
    // 默认开启意味着每个新用户首启即注入整套工具集并拉起 Helper。
    // 「defaultEnabled 仅限内容型插件」的旧约定随之恢复完整。
    // 判定式是 enabledPlugins[id] ?? defaultEnabled：曾在设置页手动开过的用户已落盘
    // 显式 true，不受本次默认值变更影响。改回默认开启时，需同步
    // packages/shared/src/plugin-marketplaces.ts 的名单（bootstrap 单测机械对照两者）、
    // isZCodeCuaInternalFeatureEnabled（打包层默认 true）与输入框入口 hidden 默认值的联动语义。
    name: "computer-use",
    hostMcpServerNames: ["node_repl"],
    // 用户露出名统一为「Computer Use / 电脑控制」。包名与 producer 仓库仍保持 zcode-cua，
    // 以兼容原生 Helper identity；EN 描述基线走 manifest
    // description，这里只放 zh-CN 覆盖；resolveLocalizedText 在 en-US 时回退到 manifest。
    listing: {
      author: ZAI_AUTHOR,
      category: "productivity",
      displayName: "Computer Use",
      displayName_i18n: { "zh-CN": "电脑控制" },
      description_i18n: {
        "zh-CN": "自动化桌面应用：智能体驱动鼠标、键盘与界面元素，代你完成实际任务。",
      },
      // 插件更名为 computer-use 后，CDN 图标仍发布在 zcode-cua 目录；沿用资源路径避免 404。
      icon: `${OFFICIAL_PLUGIN_ASSETS_BASE_URL}/zcode-cua/icon.png`,
    },
    rootCandidates: [
      "packages/zcode-cua-plugin",
      "../zcode-cua-plugin",
      "../../zcode-cua-plugin",
      "../../../zcode-cua-plugin",
    ],
    requiredSeedPaths: OFFICIAL_CUA_REQUIRED_SEED_PATHS,
    // 当前 CUA 为不可用占位包，无需复制 native runtime；避免把本地旧依赖继续带入缓存。
    runtimeTopLevelPaths: [],
    // 这里的 version 追踪上游 zcode-cua runtime 版本，使插件 UI 展示、缓存路径、
    // marketplace 条目都对齐；具体版本由原子 producer bump 工作流维护。
    version: "0.6.3",
  },
];

// 在 official plugin 定义里标了 defaultEnabled: true 的, 拼成 `<name>@<marketplace>` 形式,
// 透传给 adapter 让它在用户没显式配置时默认开启 (内容型 plugin 才适用)。
// 注意: 任何解析 plugin 的入口 (CLI 子命令 resolveZCodePlugins、应用启动 resolveStartupPlugins)
// 都必须把这个集合传给 discoverNodePluginsSync, 否则 defaultEnabled 不生效。
export const DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS: ReadonlySet<string> = new Set(
  OFFICIAL_PLUGIN_DEFINITIONS.filter((definition) => definition.defaultEnabled).map(
    (definition) => `${definition.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}`,
  ),
);

export function resolveOfficialPluginHostMcpServerNames(pluginId: string): string[] {
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find(
    (candidate) => `${candidate.name}@${ZCODE_OFFICIAL_PLUGIN_MARKETPLACE}` === pluginId,
  );
  return definition?.hostMcpServerNames ? [...definition.hostMcpServerNames] : [];
}

/**
 * 官方插件由 host CLI 注入的 MCP（如 browser-use 的 `node_repl`）server name 不带 `plugin:` 前缀，
 * 资源管理器归属插件时需要反查所属官方插件名。
 */
export function resolveOfficialPluginNameByHostMcpServerName(
  serverName: string,
): string | undefined {
  return OFFICIAL_PLUGIN_DEFINITIONS.find((definition) =>
    definition.hostMcpServerNames?.includes(serverName),
  )?.name;
}
