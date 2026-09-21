/**
 * 把旧消息投影成新库的 part 行。
 *
 * 为什么需要 part：详情页从 `part` 表还原可见正文。只写 `message.data.content` 会得到
 * 「任务能打开、历史区空白」——那是纯展示层缺陷，从 DB 里看不出来。
 *
 * 旧快照的消息结构有两代：新一代带 `parts` 数组（保留思考/工具调用顺序），老一代只有
 * 扁平的 `content` + `tools`。两条路都要走，否则恢复出来的会话会丢掉思考段或工具段。
 */

import { asNumber, asObject, asStoredText, asText, compact } from "./legacy-values.mjs";
import { messageCompletedAt, messageRole, messageText } from "./legacy-snapshot.mjs";

/**
 * 旧工具的名字。
 *
 * 优先 `raw._meta.claudeCode.toolName`——那是 Claude Code 侧最准确的记录；再依次退到
 * 扁平字段。全都没有时给一个占位名而不是空串：空 tool 名在 Detail 页会渲染成空白行。
 */
function legacyToolName(tool) {
  const raw = asObject(tool.raw);
  const meta = asObject(raw._meta);
  const claudeCode = asObject(meta.claudeCode);
  return (
    asText(claudeCode.toolName) ||
    asText(tool.toolName) ||
    asText(tool.name) ||
    asText(tool.kind) ||
    asText(tool.title) ||
    "legacy_tool"
  );
}

/** 工具调用的 ID。旧数据四种拼法都出现过，取不到就按消息+序号合成稳定的一个。 */
function legacyToolCallId(messageId, toolIndex, tool) {
  return (
    asText(tool.id) ||
    asText(tool.callID) ||
    asText(tool.callId) ||
    `call_legacy_${messageId}_${toolIndex}`
  );
}

function legacyToolMetadata(tool) {
  return compact({
    legacyRestore: true,
    legacyKind: asText(tool.kind),
    legacyStatus: asText(tool.status),
  });
}

/**
 * 单个 tool part 的 data。
 *
 * 时间必须放在 `state.time` 里：CLI session-store 持久化的是 contracts 形状，app-server
 * 映射 session/read 时读的是 `state.time`。直接写 protocol 的 startedAt/completedAt
 * 会让读取链找不到时间而失败。
 */
function buildToolPart(tool, messageId, toolIndex, messageTimestamp, completedAt) {
  const toolName = legacyToolName(tool);
  const input = asObject(tool.input);
  const metadata = legacyToolMetadata(tool);
  const status = asText(tool.status) || "completed";
  const startedAt = asNumber(tool.startedAt) ?? messageTimestamp;
  const endedAt = asNumber(tool.completedAt) ?? completedAt;

  let state;
  if (status === "running") {
    state = { status: "running", input, title: asText(tool.title) || toolName, metadata, time: { start: startedAt } };
  } else if (status === "pending") {
    // pending 没有结束时间，也没有 title/metadata：它还没产出任何东西。
    state = { status: "pending", input, raw: asStoredText(tool.raw || tool) };
  } else if (status === "failed" || status === "error" || status === "denied") {
    // 三种失败态在新契约里统一成 error；原始状态名留在 metadata 里备查。
    state = {
      status: "error",
      input,
      error: asStoredText(tool.error || tool.output || status),
      metadata,
      time: { start: startedAt, end: endedAt },
    };
  } else {
    state = {
      status: "completed",
      input,
      output: asStoredText(tool.output),
      title: asText(tool.title) || toolName,
      metadata,
      time: { start: startedAt, end: endedAt },
    };
  }

  return {
    type: "tool",
    callID: legacyToolCallId(messageId, toolIndex, tool),
    tool: toolName,
    state,
  };
}

function buildTextPart(text, startedAt, endedAt) {
  return { type: "text", text, time: { start: startedAt, end: endedAt } };
}

function buildReasoningPart(text, startedAt, endedAt) {
  return { type: "reasoning", text, time: { start: startedAt, end: endedAt } };
}

/**
 * 一条消息的完整 part 列表。
 *
 * 顺序按旧快照的 `parts` 数组；没有 `parts` 时才按「思考 → 正文 → 工具」的固定顺序合成。
 * 最后兜底：如果两条路都没产出可见文本而消息确实有 content，补一个 text part——
 * 不能因为格式没认出来就把用户打过的话吞掉。
 */
export function buildPartDataList(message, messageId, messageTimestamp) {
  const content = messageText(message);
  const completedAt = messageCompletedAt(message, messageTimestamp);
  const tools = Array.isArray(message.tools) ? message.tools : [];
  const persistedParts = Array.isArray(message.parts) ? message.parts : [];
  const parts = [];

  if (messageRole(message) === "assistant" && persistedParts.length > 0) {
    for (const part of persistedParts) {
      if (part?.type === "content" && typeof part.content === "string" && part.content.length > 0) {
        parts.push(buildTextPart(part.content, messageTimestamp, completedAt));
      } else if (
        part?.type === "thought" &&
        typeof part.content === "string" &&
        part.content.length > 0
      ) {
        parts.push(buildReasoningPart(part.content, messageTimestamp, completedAt));
      } else if (part?.type === "tool-call" && Number.isInteger(part.toolIndex)) {
        const tool = tools[part.toolIndex];
        if (tool) {
          parts.push(
            buildToolPart(tool, messageId, part.toolIndex, messageTimestamp, completedAt),
          );
        }
      }
    }
  } else {
    const thought = asText(message.thought);
    if (messageRole(message) === "assistant" && thought) {
      parts.push(buildReasoningPart(thought, messageTimestamp, completedAt));
    }
    if (content.length > 0) {
      parts.push(buildTextPart(content, messageTimestamp, completedAt));
    }
    for (const [toolIndex, tool] of tools.entries()) {
      parts.push(buildToolPart(tool, messageId, toolIndex, messageTimestamp, completedAt));
    }
  }

  const hasVisibleText = parts.some(
    (part) => (part.type === "text" || part.type === "reasoning") && part.text.length > 0,
  );
  if (!hasVisibleText && content.length > 0) {
    parts.push(buildTextPart(content, messageTimestamp, completedAt));
  }
  return parts;
}

export { buildReasoningPart, buildTextPart, buildToolPart };
