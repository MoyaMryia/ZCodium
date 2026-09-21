/**
 * 旧 ACP 会话快照的读取与归一。
 *
 * 恢复与扫描共用本模块。两者的差别只在「读到之后做什么」：扫描只读不写，恢复会把
 * 归一结果投影进新的 task-index 与 CLI session DB。
 *
 * 关于 ID：旧快照的文件名与 `meta.taskId` 是历史 ID，而应用任务列表实际用的是
 * `meta.acpSessionId`。取 `acpSessionId || taskId` 作为新库里唯一认的 ID——
 * 用错的那个会让任务明明写进去了却不在列表里显示。
 */

import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";

import { asNumber, asObject, asText, summarizeText } from "./legacy-values.mjs";

/** 恢复后的任务一律按 glm 落库，否则任务列表会把它过滤掉。 */
export const RESTORED_PROVIDER = "glm";

/** 恢复时写入 CLI session 行的 schema 版本。 */
const SESSION_SCHEMA_VERSION = "0.14.5";

/** 一条消息的角色。非 assistant 一律按 user 归一——旧快照里出现过空 role。 */
function messageRole(message) {
  return message?.role === "assistant" ? "assistant" : "user";
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (content === undefined || content === null) return "";
  return String(content);
}

/**
 * 一条消息的完成时刻。
 *
 * 有显式 `timestamp` 时叠加 `durationMs`；没有时退到消息级时间戳，再没有就退回
 * 调用方给的值。绝不复现「时间为 undefined 直接写进列」——那会让排序错乱。
 */
function messageCompletedAt(message, fallbackTimestamp) {
  if (typeof message?.timestamp === "number") {
    return message.timestamp + (asNumber(message.durationMs) ?? 0);
  }
  return fallbackTimestamp;
}

function firstMessageTimestamp(messages) {
  for (const message of messages) {
    const timestamp = asNumber(message?.timestamp);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

function lastMessageTimestamp(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const timestamp = asNumber(messages[index]?.timestamp);
    if (timestamp !== undefined) return timestamp;
  }
  return undefined;
}

/**
 * 读一个快照文件并归一成扫描视图。
 *
 * 解析失败时返回带 `error` 的对象而不是抛错：一个坏文件不该让整轮扫描失败，
 * 而用户需要知道有这么一个文件存在。
 */
export function readLegacySnapshot(filePath) {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    const meta = asObject(raw?.meta);
    const messages = Array.isArray(raw?.messages) ? raw.messages : [];

    const legacyTaskId = String(meta.taskId || basename(filePath, ".json"));
    const acpSessionId = asText(meta.acpSessionId) || "";
    const workspacePath = asText(meta.workspacePath) || "";
    const createdAt = asNumber(meta.createdAt) ?? firstMessageTimestamp(messages) ?? 0;
    const updatedAt = asNumber(meta.updatedAt) ?? lastMessageTimestamp(messages) ?? createdAt;

    return {
      filePath,
      // 快照按 workspaceHash 分目录存放，目录名就是它。
      workspaceHash: basename(dirname(filePath)),
      legacyTaskId,
      acpSessionId,
      restoredTaskId: acpSessionId || legacyTaskId,
      workspacePath,
      workspaceIdentity: asText(meta.workspaceIdentity),
      provider: asText(meta.provider) || "unknown",
      model: asText(meta.model),
      // 标题只占位，不在这里取值：两个入口的策略不同（见 scanTitleOf / restoreTitleOf）。
      // 预留键位是为了让调用方赋值时不改变键序——`conversations --json` 直接序列化这个
      // 对象，键序漂移会让每次输出都和上一次不一样，diff 失去意义。
      title: undefined,
      createdAt,
      updatedAt,
      messages,
      messageCount: messages.length,
      userMessageCount: messages.filter((message) => messageRole(message) === "user").length,
      assistantMessageCount: messages.filter((message) => messageRole(message) === "assistant")
        .length,
      visibleText: messages.map((message) => messageText(message)).join("\n"),
      // 原始 meta 原样透出：两个入口对它的取值策略不同（见 scanTitleOf / restoreTitleOf），
      // 在读取层就挑一个会静默改掉另一个的行为。
      meta,
    };
  } catch (error) {
    return {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 扫描视图的标题。
 *
 * 回退到首条用户消息的摘要：旧快照有相当比例没写 `meta.title`，而没有标题的行在
 * 选择列表里等于不可选。
 */
export function scanTitleOf(snapshot) {
  return (
    asText(snapshot.meta.title) ||
    summarizeText(firstUserText(snapshot)) ||
    "Untitled session"
  );
}

/**
 * 恢复视图的标题。
 *
 * 只有 `meta.title`，没有消息回退。这是有意的分歧：恢复要把标题原样写进任务列表，
 * 用正文摘要去填会让用户看到一个他没起过的名字，且之后无法区分是哪个会话。
 */
export function restoreTitleOf(snapshot) {
  return asText(snapshot.meta.title) || "Untitled session";
}

function firstUserText(snapshot) {
  const firstUser = snapshot.messages.find((message) => messageRole(message) === "user");
  return firstUser ? messageText(firstUser) : "";
}

/**
 * workspace 身份 key。
 *
 * `workspaceIdentity` 用于身份隔离，`workspacePath` 用于文件操作与展示。两者都空时
 * 落到 path——不能落成空串，那会把所有无身份的工作区合并成同一行。
 */
export function workspaceKeyOf(workspacePath, workspaceIdentity) {
  return (workspaceIdentity || "").trim() || workspacePath;
}

/**
 * CLI session 的 project_id 约定。
 *
 * 与现有 CLI session 的生成方式保持一致：去掉前导斜杠后把其余斜杠换成连字符。
 * 不一致的后果是同一个 workspace 在任务列表里出现两行。
 */
export function projectIdFor(workspacePath) {
  return `proj_${workspacePath.replace(/^\//, "").replace(/\//g, "-")}`;
}

/**
 * 恢复计划里的 meta 归一。
 *
 * 关键点是 `provider` 被改写为 glm：旧 ACP provider 只代表来源，恢复后的新任务必须
 * 按 glm 写。`migrationSource` 一律不写——那个枚举是给 Claude Code 原生导入路径
 * 保留的，ACP 时代的恢复写了它反而会被当成另一条迁移链。
 */
export function normalizeRestoreMeta(snapshot) {
  return {
    ...snapshot.meta,
    taskId: snapshot.restoredTaskId,
    traceId: asText(snapshot.meta.traceId) || `zcode-${snapshot.restoredTaskId}`,
    title: restoreTitleOf(snapshot),
    workspacePath: snapshot.workspacePath,
    workspaceIdentity: asText(snapshot.meta.workspaceIdentity),
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    mode: asText(snapshot.meta.mode) || "build",
    model: asText(snapshot.meta.model),
    thoughtLevel: asText(snapshot.meta.thoughtLevel),
    runtimeEpoch: asNumber(snapshot.meta.runtimeEpoch),
    provider: RESTORED_PROVIDER,
    legacyTaskId: snapshot.legacyTaskId,
    restoredTaskId: snapshot.restoredTaskId,
    workspaceHash: snapshot.workspaceHash,
    messageCount: snapshot.messageCount,
  };
}

export { messageCompletedAt, messageRole, messageText, SESSION_SCHEMA_VERSION };
