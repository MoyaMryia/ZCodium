import type { ClientSceneConfig, ClientSceneItem } from "./clientScenes.js";

type LocalizedText = { cn: string; en: string };

function item(
  id: string,
  img: string,
  labels: LocalizedText,
  contents: LocalizedText,
): ClientSceneItem {
  return { id, type: "prompt", img, labels, contents };
}

const recommendations = [
  item(
    "explain-project",
    "folder-search",
    { cn: "了解这个项目", en: "Explore this project" },
    {
      cn: "阅读当前项目的说明和主要入口，解释目录结构、运行方式与关键模块，并指出需要进一步确认的地方。",
      en: "Read this project's documentation and main entry points. Explain its structure, how to run it, and the key modules. Identify anything that needs further verification.",
    },
  ),
  item(
    "review-changes",
    "git-pull-request",
    { cn: "审查当前改动", en: "Review current changes" },
    {
      cn: "审查当前 Git 改动，优先找出可能的错误、兼容性问题和缺失的验证。按严重程度说明依据，先不要修改文件。",
      en: "Review the current Git changes for bugs, compatibility problems, and missing validation. Explain findings in severity order with evidence. Do not edit files yet.",
    },
  ),
  item(
    "investigate-failure",
    "bug",
    { cn: "排查问题", en: "Investigate a problem" },
    {
      cn: "帮我排查当前项目的问题。先确认复现步骤、预期行为和实际结果，再结合源码与必要的本地诊断区分已确认原因和待验证假设。",
      en: "Help investigate a problem in this project. First establish reproduction steps, expected behavior, and actual results. Use source code and relevant local diagnostics to distinguish confirmed causes from hypotheses.",
    },
  ),
  item(
    "plan-change",
    "list-checks",
    { cn: "规划功能实现", en: "Plan a feature" },
    {
      cn: "根据当前项目的架构，帮我规划一个功能改动。先确认目标与验收条件，再列出涉及的模块、接口、风险和可分批验证的实现步骤。",
      en: "Help plan a feature change using this project's architecture. Clarify the objective and acceptance criteria, then identify modules, interfaces, risks, and implementation steps that can be validated separately.",
    },
  ),
  item(
    "summarize-material",
    "file-text",
    { cn: "整理材料", en: "Summarize material" },
    {
      cn: "整理我提供的文件或材料，提取主要结论、依据和待办事项。保留来源定位，区分原文事实与推断，并说明无法读取或尚未核实的内容。",
      en: "Summarize the files or material I provide, extracting conclusions, evidence, and action items. Preserve source references, distinguish facts from inferences, and identify unreadable or unverified content.",
    },
  ),
];

const scheduledPrompts = [
  {
    ...item(
      "morning-git-summary",
      "git-branch",
      { cn: "工作日项目摘要", en: "Weekday project summary" },
      {
        cn: "读取当前项目最近一个工作日的本地 Git 提交与工作区状态，总结主要变化、未完成事项和需要我确认的问题。只生成报告，不修改文件或向外部发送报告。",
        en: "Review this project's local Git commits from the last working day and its working tree status. Summarize changes, unfinished work, and questions for me. Produce a report without modifying files or sending it elsewhere.",
      },
    ),
    defaults: { cronExpr: ["weekday-morning"] },
  },
  {
    ...item(
      "documentation-review",
      "book-open",
      { cn: "每周文档检查", en: "Weekly documentation review" },
      {
        cn: "对照当前项目源码检查 README 中的命令、入口和功能描述，列出过期或缺失的说明及对应源码依据。只生成待修订清单，不自动修改文档。",
        en: "Compare the README's commands, entry points, and feature descriptions with the current source. List outdated or missing documentation with source evidence. Produce a revision checklist without changing documents.",
      },
    ),
    defaults: { cronExpr: ["weekly-review"] },
  },
  {
    ...item(
      "release-summary",
      "file-check",
      { cn: "每周变更摘要", en: "Weekly change summary" },
      {
        cn: "根据当前项目最近七天的本地 Git 提交，起草面向用户的变更摘要，区分新功能、修复和兼容性变化。标明未验证的部分，不创建标签、不推送、不发布。",
        en: "Draft a user-facing summary from this project's local Git commits over the last seven days. Separate features, fixes, and compatibility changes. Identify unverified details. Do not create tags, push, or publish.",
      },
    ),
    defaults: { cronExpr: ["weekly-review"] },
  },
];

/** Read-only product content; no account, endpoint, image URL, or device context. */
const bundledScenes: ClientSceneConfig[] = [
  {
    namespace: "zcodium",
    scene: "draft-suggestion",
    options: {
      prompts: {
        id: "prompts",
        type: "prompts",
        contents: { cn: "开始任务", en: "Start a task" },
        items: recommendations,
      },
    },
  },
  {
    namespace: "zcodium",
    scene: "scheduled-task",
    options: {
      prompts: {
        id: "prompts",
        type: "prompts",
        contents: { cn: "定时任务", en: "Scheduled tasks" },
        items: scheduledPrompts,
      },
      cronExpr: {
        id: "cronExpr",
        type: "cronExpr",
        contents: { cn: "执行时间", en: "Schedule" },
        items: [
          {
            id: "weekday-morning",
            type: "cronExpr",
            labels: { cn: "工作日 09:00", en: "Weekdays at 09:00" },
            contents: { cn: "0 9 * * 1-5", en: "0 9 * * 1-5" },
          },
          {
            id: "weekly-review",
            type: "cronExpr",
            labels: { cn: "周五 16:00", en: "Fridays at 16:00" },
            contents: { cn: "0 16 * * 5", en: "0 16 * * 5" },
          },
        ],
      },
    },
  },
];

export function readBundledClientScenes(): ClientSceneConfig[] {
  return structuredClone(bundledScenes);
}
