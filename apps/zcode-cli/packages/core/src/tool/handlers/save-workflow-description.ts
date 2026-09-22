// Composed at module load from the dynamic-workflow facade so the model always
// sees the current API surface — same construction as CreateWorkflow's description.

import { FACADE_DTS } from "@zcode/dynamic-workflow";
import { SAVED_WORKFLOW_GLOBAL_DIR, SAVED_WORKFLOW_PROJECT_DIR } from "@zcode/contracts";

const INTRO = [
  "Save a dynamic-workflow script so it can be run again later by name. The required `scope` field decides where it lives.",
  `Project definitions go in \`${SAVED_WORKFLOW_PROJECT_DIR}/<name>.dwf.ts\`, committed with the repository like any other source file and visible only inside it. Global definitions go in \`~/${SAVED_WORKFLOW_GLOBAL_DIR}/<name>.dwf.ts\` and are available from every project on this machine. Run either with CreateWorkflow's \`saved\` source; discover them with ListSavedWorkflows.`,
].join(" ");

/**
 * 提示策略。这段是本工具描述里**最重要**的部分，所以写在最前、用最直白的祈使句。
 *
 * 理由：保存会在用户的仓库里留下一个文件，而模型对「这个 workflow 看起来挺通用」的判断
 * 远比用户宽松。一个会自作主张保存的 agent 会在几轮对话里往 `.zcodium/workflows` 里堆满
 * 半成品，而那些文件此后会出现在每一次 ListSavedWorkflows 里。所以门槛不是"别乱存"这种
 * 程度副词，而是一条硬规则：先用散文建议，等用户点头，再调用。
 */
const HINT_POLICY = [
  "When to call it — read this before you call it:",
  "- NEVER call this tool unsolicited. Saving writes a file into the user's repository; that is their decision, not yours.",
  "- When a workflow you just built looks reusable, SUGGEST it in prose first — one sentence naming what you would save and why — and then stop and wait. Call SaveWorkflow only after the user agrees.",
  '- If the user asks directly ("save this workflow", "保存这个工作流"), that is agreement: call it.',
  "- A workflow is worth suggesting when it would plausibly be run again with different inputs. A one-off script tailored to a single question is not; suggesting it wastes the user's attention and clutters the project.",
].join("\n");

const FILE_FORMAT = [
  "File format:",
  "- The saved file is valid TypeScript: a `/* zcode-workflow` block comment carrying YAML metadata, followed by the script verbatim.",
  "- `description` is required and shows up wherever the workflow is listed. `whenToUse` is optional guidance for whoever picks a workflow later — write it for a reader who has not seen this conversation.",
  // 保存一份刚跑过的草稿是最常见的场景，而重新吐一遍脚本是这里唯一一笔可以省掉的大代价。
  "- `script_path` saves a working draft without re-emitting it: pass the file a CreateWorkflow or AmendWorkflow result named instead of `script`, and its body is what gets saved (a `/* zcode-workflow` block in that file is dropped — the metadata comes from the fields here).",
  "- Saving over an existing name REPLACES that workflow. The confirmation window tells the user whether this is a new file or an overwrite, so pick the name deliberately: reuse it to update a workflow, choose a new one to add a variant.",
].join("\n");

const ARGS = [
  "Arguments:",
  "- Declare `args` when the workflow should be reusable with different inputs — a PR number, a directory, a depth. Each declaration gives a `type` (`string`, `number`, `boolean`, or `json` for anything else), and optionally a `description`, `required: true`, and a `default`.",
  "- Declared arguments are the workflow's calling convention: whoever runs it later must supply them, and CreateWorkflow validates the call against this declaration (unknown keys, missing required values and wrong types are rejected) before anything runs.",
  "- Declare exactly the values that would change between runs, and no more. Every declared argument is one more thing a future caller has to get right.",
].join("\n");

const RULES = [
  "Authoring rules — identical to CreateWorkflow, because the script is checked by the same compiler:",
  "- Plain TypeScript. Define result types with a plain `interface Foo { ... }` or `type Foo = ...` and pass them as `ask<T>` type arguments.",
  "- Compiled under `strict` (with `noUncheckedIndexedAccess` off): indexing an array or record (`items[i]`) needs no guard. `.find()`, `.match()`, `Map.get()` and optional properties still yield `T | undefined` / `null` and must be guarded before use.",
  "- Never use the `declare` modifier, no `export` statements, and no `import` statements.",
  "- No Node/web APIs: `process`, `fetch`, `fs` do not exist and fail typechecking.",
  '- Group the script into phases with `phase("...")` markers, exactly as CreateWorkflow requires — a saved workflow shows the same phase graph whenever anyone runs it by name. Phase names are human-readable phrases in the session\'s language at save time; future callers did not see this conversation, so the names are all they get.',
  "- The script is typechecked BEFORE the user is asked. Compilation errors come back as diagnostics and nothing is written: fix the script and call the tool again.",
].join("\n");

export const SAVE_WORKFLOW_TOOL_DESCRIPTION = [
  INTRO,
  "",
  HINT_POLICY,
  "",
  FILE_FORMAT,
  "",
  ARGS,
  "",
  "The script is checked against these facade declarations:",
  "```ts",
  FACADE_DTS.trim(),
  "```",
  "",
  RULES,
].join("\n");
