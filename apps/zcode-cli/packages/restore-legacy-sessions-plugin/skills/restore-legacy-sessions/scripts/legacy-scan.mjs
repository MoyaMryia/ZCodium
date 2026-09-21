/**
 * 旧会话的扫描、分组与输出。
 *
 * 只读：不写任何库。目的地库缺表时一律记为 missing，不创建也不修复——扫描阶段的
 * 职责是回答「有哪些、在什么状态」，不是把环境修好。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { openReadOnly } from "./legacy-sqlite.mjs";
import { scanTitleOf, readLegacySnapshot } from "./legacy-snapshot.mjs";

/** 只读打开目的地库；打不开就返回 null，调用方按 missing 处理。 */
function openReadOnlyDatabase(path) {
  return openReadOnly(path);
}

/**
 * 收集快照文件。
 *
 * 目录结构是 `<root>/<workspaceHash>/<legacyTaskId>.json`。跳过 `.deleted.json`：
 * 那是用户显式删掉的会话，扫出来会让用户以为还能恢复。
 */
export function collectSnapshotFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const workspaceDir of readdirSync(root)) {
    const dirPath = join(root, workspaceDir);
    if (!statSync(dirPath).isDirectory()) continue;
    for (const fileName of readdirSync(dirPath)) {
      if (!fileName.endsWith(".json") || fileName.endsWith(".deleted.json")) continue;
      files.push(join(dirPath, fileName));
    }
  }
  return files;
}

/**
 * 读快照并补上扫描视图的标题。
 *
 * 读完之后立刻丢掉 `messages` 与 `meta`：扫描只需要计数与时间，而 `conversations
 * --json` 会把候选原样序列化。留着它们会让一次列会话的操作吐出整份会话正文与原始
 * meta——既是噪音也是隐私面。恢复路径需要这两个字段，所以留在 legacy-snapshot 里，
 * 由本函数在扫描边界上裁掉。
 */
function scanSnapshot(filePath) {
  const snapshot = readLegacySnapshot(filePath);
  if (snapshot.error) return snapshot;
  const { messages: _messages, meta: _meta, ...rest } = snapshot;
  // title 在读取时已占位，这里赋值不会把它挪到末尾。
  return { ...rest, title: scanTitleOf(snapshot) };
}

/**
 * 查询目的地库，给每个候选打上恢复状态。
 *
 * 三个计数：按 restoredTaskId 命中 tasks、按 legacyTaskId 命中 tasks、按 restoredTaskId
 * 命中 session。task-index 命中 legacyTaskId 仍算「在」，只是那条是老 ID 写的——
 * 这种状态下恢复会把 ID 收敛到新的那个。
 */
function attachStoreStatus(candidates, taskIndexPath, cliDbPath) {
  const taskIndexDb = openReadOnlyDatabase(taskIndexPath);
  const cliDb = openReadOnlyDatabase(cliDbPath);
  // 两个 ID 用的是同一条 SQL：查询条件完全一样，只是绑定的 task_id 不同。
  const taskById = statementOrNull(
    taskIndexDb,
    "select count(*) as count from tasks where workspace_path = ? and task_id = ?",
  );
  const cliBySession = statementOrNull(cliDb, "select count(*) as count from session where id = ?");

  for (const candidate of candidates) {
    if (candidate.error) continue;
    const taskIndexRestored = countOf(taskById?.get(candidate.workspacePath, candidate.restoredTaskId));
    const taskIndexLegacy = countOf(taskById?.get(candidate.workspacePath, candidate.legacyTaskId));
    const cliSession = countOf(cliBySession?.get(candidate.restoredTaskId));
    candidate.store = {
      cliDb: cliSession > 0 ? "present" : "missing",
      taskIndex: taskIndexRestored > 0 ? "present" : taskIndexLegacy > 0 ? "legacy-task-id" : "missing",
    };
    candidate.restoreState = restoreStateOf(candidate.store);
  }

  taskIndexDb?.close();
  cliDb?.close();
}

function statementOrNull(db, sql) {
  if (!db) return null;
  try {
    return db.prepare(sql);
  } catch {
    return null;
  }
}

function countOf(row) {
  return typeof row?.count === "number" ? row.count : 0;
}

/**
 * 四种恢复状态。
 *
 * 两边的存在性是正交的，所以是 2×2。`legacy-task-id` 在 task-index 侧算 present：
 * 那条行确实存在，只是 ID 是旧的。
 */
function restoreStateOf(store) {
  const cliPresent = store.cliDb === "present";
  const taskPresent = store.taskIndex === "present";
  if (cliPresent && taskPresent) return "ready";
  if (!cliPresent && taskPresent) return "needs-cli-db";
  if (cliPresent && !taskPresent) return "needs-task-index";
  return "needs-full-import";
}

/**
 * 按 agent / workspace / query / conversation 过滤。
 *
 * `--agent all` 是显式的「不过滤」，与不传语义相同——不特殊处理的话用户会被一个
 * 叫 all 的不存在 provider 挡住。
 */
export function filterCandidates(candidates, args) {
  const query = args.query?.toLowerCase();
  const conversation = args.conversation?.toLowerCase();
  return candidates.filter((candidate) => {
    if (candidate.error) return false;
    if (args.agent && args.agent !== "all" && candidate.provider !== args.agent) return false;
    if (args.workspace && candidate.workspacePath !== args.workspace) return false;
    if (
      conversation &&
      ![candidate.restoredTaskId, candidate.legacyTaskId, candidate.acpSessionId]
        .filter(Boolean)
        .some((value) => value.toLowerCase() === conversation)
    ) {
      return false;
    }
    if (!query) return true;
    const haystack = [
      candidate.provider,
      candidate.workspacePath,
      candidate.title,
      candidate.restoredTaskId,
      candidate.legacyTaskId,
      candidate.acpSessionId,
      candidate.visibleText,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }
  return map;
}

/** 分组成统计行。排序按数量降序，同数量按 key 字典序，保证输出稳定。 */
export function summarizeGroups(candidates, keyFn) {
  return [...groupBy(candidates, keyFn).entries()]
    .map(([key, items]) => ({
      key,
      count: items.length,
      workspaces: new Set(items.map((item) => item.workspacePath)).size,
      ready: items.filter((item) => item.restoreState === "ready").length,
      needsCliDb: items.filter((item) => item.restoreState === "needs-cli-db").length,
      needsTaskIndex: items.filter((item) => item.restoreState === "needs-task-index").length,
      needsFullImport: items.filter((item) => item.restoreState === "needs-full-import").length,
      latestUpdatedAt: Math.max(...items.map((item) => item.updatedAt || 0)),
    }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function escapeCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .trim();
}

export function markdownTable(headers, rows) {
  const header = `| ${headers.map(escapeCell).join(" | ")} |`;
  const divider = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

export function formatTime(ms) {
  if (!ms) return "";
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
}

export function printAgents(candidates, json) {
  const rows = summarizeGroups(candidates, (item) => item.provider);
  if (json) return printJson(rows);
  console.log(
    markdownTable(
      ["agent", "conversations", "workspaces", "ready", "needs-cli-db", "needs-task-index", "needs-full-import"],
      rows.map((row) => [
        row.key,
        row.count,
        row.workspaces,
        row.ready,
        row.needsCliDb,
        row.needsTaskIndex,
        row.needsFullImport,
      ]),
    ),
  );
}

export function printWorkspaces(candidates, json) {
  const rows = summarizeGroups(candidates, (item) => item.workspacePath);
  if (json) return printJson(rows);
  console.log(
    markdownTable(
      ["workspace", "conversations", "ready", "needs-cli-db", "needs-task-index", "needs-full-import", "latest"],
      rows.map((row) => [
        row.key,
        row.count,
        row.ready,
        row.needsCliDb,
        row.needsTaskIndex,
        row.needsFullImport,
        formatTime(row.latestUpdatedAt),
      ]),
    ),
  );
}

export function printConversations(candidates, args) {
  const rows = [...candidates]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, args.limit);
  if (args.json) return printJson(rows.map(stripVisibleText));
  console.log(
    markdownTable(
      ["#", "state", "agent", "title", "messages", "updated", "restoredTaskId", "legacyTaskId"],
      rows.map((row, index) => [
        index + 1,
        row.restoreState,
        row.provider,
        row.title,
        row.messageCount,
        formatTime(row.updatedAt),
        row.restoredTaskId,
        row.legacyTaskId,
      ]),
    ),
  );
}

/** visibleText 可能很大（整段会话正文），JSON 输出默认不带。 */
function stripVisibleText(candidate) {
  const { visibleText: _visibleText, ...rest } = candidate;
  return rest;
}

export function printSummary(candidates, invalid, json) {
  const payload = {
    total: candidates.length,
    invalid: invalid.length,
    byAgent: summarizeGroups(candidates, (item) => item.provider),
    byState: summarizeGroups(candidates, (item) => item.restoreState),
  };
  if (json) return printJson(payload);
  console.log(`Total legacy conversations: ${payload.total}`);
  if (payload.invalid > 0) console.log(`Invalid snapshots: ${payload.invalid}`);
  console.log("\nBy agent:");
  printAgents(candidates, false);
  console.log("\nBy restore state:");
  console.log(
    markdownTable(
      ["state", "conversations", "workspaces"],
      payload.byState.map((row) => [row.key, row.count, row.workspaces]),
    ),
  );
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

/**
 * 扫描主流程。
 *
 * 坏文件与好文件分开：坏文件计入 invalid 供用户看到，但不参与分组统计——
 * 让一个解析不了的 JSON 把整个 provider 的计数拉偏会更难解释。
 */
export function runScan(args) {
  const raw = collectSnapshotFiles(args.legacyDir).map(scanSnapshot);
  const invalid = raw.filter((candidate) => candidate.error);
  const valid = raw.filter((candidate) => !candidate.error);
  attachStoreStatus(valid, args.taskIndexPath, args.cliDbPath);
  const filtered = filterCandidates(valid, args);

  if (args.command === "summary") printSummary(filtered, invalid, args.json);
  else if (args.command === "agents") printAgents(filtered, args.json);
  else if (args.command === "workspaces") printWorkspaces(filtered, args.json);
  else if (args.command === "conversations") printConversations(filtered, args);
  else throw new Error(`Unknown command: ${args.command}`);
}
