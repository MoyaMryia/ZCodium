import { posix } from "node:path";

export const REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME = "packages";

/**
 * 纯内容内置插件：只有 skills/agents/commands/docs，没有 dist runtime 也没有系统依赖，
 * 因此可以安全进入远端工作区。与 scripts/prepare-prebuilds.mjs、
 * packages/desktop/scripts/prepare-agent-node-bundle.mjs 的清单同源同序，
 * 契约见 .agents/specs/builtin-plugin-parity.md。
 */
/**
 * documents 的 seed 清单与 bootstrap 的 `requiredSeedPaths` 同源。
 * Python 脚本与 OOXML 模板是技能正文描述的全部能力的执行体，缺任一项都会 seed 出
 * 「看得见 docx 技能却 import 不到 document.py」的残缺插件。
 */
const DOCUMENTS_PLUGIN_SEED_PATHS = [
  // 与 bootstrap 的 OFFICIAL_DOCUMENTS_REQUIRED_SEED_PATHS 同源。
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
  "skills/docx/scenes/academic.md",
  "skills/docx/scenes/contract.md",
  "skills/docx/scenes/copywriting.md",
  "skills/docx/scenes/exam.md",
  "skills/docx/scenes/official-doc.md",
  "skills/docx/scenes/report.md",
  "skills/docx/scenes/resume.md",
  "skills/docx/references/chart-templates.md",
  "skills/docx/references/common-rules.md",
  "skills/docx/references/decorations.md",
  "skills/docx/references/design-system.md",
  "skills/docx/references/faq.md",
  "skills/docx/references/math-formulas.md",
  "skills/docx/references/xmleditor-api.md",
] as const;

const PDF_PLUGIN_SEED_PATHS = [
  // 与 bootstrap 的 OFFICIAL_PDF_REQUIRED_SEED_PATHS 同源。scripts/ 是渲染与表单
  // 能力的执行体，convert_pdf_to_images.py 同时是 visual-judge 工作流的渲染门。
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
  "skills/pdf/scripts/html2pdf.py",
  "skills/pdf/scripts/html2pdf_render.py",
  "skills/pdf/scripts/cover_render.py",
  "skills/pdf/scripts/toc_validate.py",
  "skills/pdf/scripts/toc_validate_document.py",
] as const;

const SPREADSHEETS_PLUGIN_SEED_PATHS = [
  // recalc.py 是 SKILL.md「Recalculating formulas」章节的唯一执行体。
  "agents/visual-judge.md",
  "skills/xlsx/SKILL.md",
  "skills/xlsx/scripts/recalc.py",
] as const;

const REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_SEED_PATHS = {
  "presentations-plugin": ["agents/visual-judge.md", "skills/pptx/SKILL.md"],
  "documents-plugin": DOCUMENTS_PLUGIN_SEED_PATHS,
  "pdf-plugin": PDF_PLUGIN_SEED_PATHS,
  "spreadsheets-plugin": SPREADSHEETS_PLUGIN_SEED_PATHS,
  "image-search-plugin": [".mcp.json"],
  "plugin-creator-plugin": [
    "skills/plugin-creator/SKILL.md",
    "skills/plugin-creator/scripts/create-basic-plugin.mjs",
    "skills/plugin-creator/scripts/marketplace-files.mjs",
    "skills/plugin-creator/scripts/upsert-dev-marketplace.mjs",
    "skills/plugin-creator/scripts/scaffold-files.mjs",
    "skills/plugin-creator/scripts/validate-plugin.mjs",
    "skills/plugin-creator/references/plugin-json-spec.md",
    "skills/plugin-creator/references/installing-and-updating.md",
  ],
  "zcode-guide-plugin": [
    "commands/workflow.md",
    "skills/dynamic-workflows/SKILL.md",
    "skills/dynamic-workflows/examples.md",
    "skills/dynamic-workflows/patterns.md",
  ],
  // skill-creator 与 restore-legacy-sessions 在 bootstrap 定义里没有 requiredSeedPaths，
  // 远端侧同样只校验 manifest，保持与桌面/远端既有语义一致。
  "skill-creator-plugin": [],
  "restore-legacy-sessions-plugin": [],
} as const satisfies Record<
  (typeof REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_PACKAGE_NAMES)[number],
  readonly string[]
>;

const REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_PACKAGE_NAMES = [
  // 校验范围必须与发行清单一致，避免远端要求未发行的插件资源。
  "presentations-plugin",
  "documents-plugin",
  "pdf-plugin",
  "spreadsheets-plugin",
  "skill-creator-plugin",
  "plugin-creator-plugin",
  "image-search-plugin",
  "restore-legacy-sessions-plugin",
  "zcode-guide-plugin",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES = [
  "browser-use-plugin",
  ...REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_PACKAGE_NAMES,
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_INCLUDED_TOP_LEVEL_PATHS = [
  ".mcp.json",
  ".zcodium-plugin",
  "README.md",
  // 开发态远程插件复制使用独立白名单，遗漏 agents 会只在远端丢失子代理。
  "agents",
  "commands",
  "dist",
  "docs",
  "hooks",
  "output-styles",
  "package.json",
  // Browser bootstrap 会从插件根目录动态导入 scripts/browser-client.mjs。
  // 开发态 SSH 部署若漏掉 scripts，会出现 MCP server 已启动但浏览器绑定无法初始化的半成品状态。
  "scripts",
  "skills",
  "templates",
] as const;

export const REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS = [
  ...REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.map(
    (packageName) => `${packageName}/.zcodium-plugin/plugin.json`,
  ),
  // 只校验 Browser Use manifest 会把“有插件壳”的残缺目录
  // 误判为可复用。生产 remote、开发态 remote 与 release source 校验共用这份必需资产合同。
  //
  // 这里只能列 browser-use **自己产出**的资产。node_repl 宿主抽成 @zcode/node-repl-host 后
  // browser-use 不再产出 dist/mcp/server.js；
  // 本清单里指向不存在的文件，会让远端资产校验对着幽灵路径报缺失。
  // 远程工作区当前不承载 Browser Use / Computer Use，因此宿主 runtime 不进这份远端合同——
  // 要支持远程 bua/cua 时，应把 node-repl-host 补进上面的 PACKAGE_NAMES 并在此声明它的
  // dist/mcp/server.js，而不是把宿主产物挂回 browser-use 名下。
  "browser-use-plugin/docs/api.json",
  "browser-use-plugin/docs/documents.json",
  "browser-use-plugin/docs/overview.md",
  // 远端缓存若缺少 recording 正文，documents.json 仍会错误宣告该 lookup 可用。
  "browser-use-plugin/docs/recording.md",
  "browser-use-plugin/docs/workflow.md",
  "browser-use-plugin/scripts/browser-client.mjs",
  "browser-use-plugin/skills/control-browser/SKILL.md",
  "browser-use-plugin/skills/web-gui-tester/SKILL.md",
  // 内容插件的技能正文：只校验 manifest 会发现不了技能被裁成空壳。
  // 取值与 bootstrap 的 requiredSeedPaths 对齐，缺项即拒绝 seed。
  ...REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_PACKAGE_NAMES.flatMap((packageName) => {
    const requiredSeedPaths = REMOTE_AGENT_OFFICIAL_CONTENT_PLUGIN_SEED_PATHS[packageName];
    return requiredSeedPaths.map((relativePath) => `${packageName}/${relativePath}`);
  }),
  // 仅校验 manifest 无法发现文档插件缺少技能正文或视觉评审 Agent。
  //
  // computer-use 有意不进这份远端合同：它的原生执行依赖 node-repl-host 的
  // dist/mcp/server.js，而宿主 runtime 不向远端工作区发布（见上方说明）。
  // 把 zcode-cua-plugin 加进来只会 seed 出一个看得见 computer-use 却调不到任何方法的残缺插件。
] as const;

export function buildRemoteAgentOfficialPluginDir(remoteProviderDir: string): string {
  return posix.join(remoteProviderDir, REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME);
}

export function buildRemoteAgentOfficialPluginSourceRelativePath(params: {
  runtimeResourceDir: string;
  platformArch: string;
}): string {
  return posix.join(
    params.runtimeResourceDir,
    params.platformArch,
    REMOTE_AGENT_OFFICIAL_PLUGIN_DIR_NAME,
  );
}

export function buildRemoteAgentOfficialPluginRequiredPaths(remoteProviderDir: string): string[] {
  const remoteOfficialPluginDir = buildRemoteAgentOfficialPluginDir(remoteProviderDir);
  return REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.map((relativePath) =>
    posix.join(remoteOfficialPluginDir, relativePath),
  );
}
