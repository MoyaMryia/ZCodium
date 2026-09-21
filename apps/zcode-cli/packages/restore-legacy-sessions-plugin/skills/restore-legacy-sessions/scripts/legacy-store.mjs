/**
 * 恢复目的地的写入层。
 *
 * 两个库、三张表：`tasks-index.sqlite` 的 tasks 表登记任务元数据，`db.sqlite` 的
 * session / message / part 三张表承载会话本体。
 *
 * 三条不可破的规则：
 *   1. 幂等。重复恢复同一个快照不能把用户已经续写的内容覆盖掉。
 *   2. 不碰用户改过的字段。title_overridden、pinned、archived、deleted 一律保留。
 *   3. 不复制旧的身份字段。写当前消息契约，否则恢复出来的数据又要再迁移一次。
 */

import { copyFileSync, existsSync, statSync } from "node:fs";

import { asNumber, asStoredText, asText, compact } from "./legacy-values.mjs";
import {
  RESTORED_PROVIDER,
  SESSION_SCHEMA_VERSION,
  messageCompletedAt,
  messageRole,
} from "./legacy-snapshot.mjs";
import { buildPartDataList } from "./legacy-parts.mjs";

/** 校验库文件存在且非空。空文件会被 sqlite 当成新库，之后所有查询都静默失败。 */
export function ensurePopulatedDb(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`${label} is not a populated sqlite file: ${path}`);
  }
}

/**
 * 写前备份。
 *
 * 恢复是不可逆的结构性写入，而用户往往在恢复之后才发现选错了会话。备份名带时间戳，
 * 同一个库恢复多次会留下多个副本——这是故意的，回滚需要能选点。
 */
export function backupDb(path) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.bak-${stamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

/**
 * tasks 表 upsert。
 *
 * 冲突时的取值策略是「新数据进、用户修改留」：
 *   - title 只在用户没有自定义过时更新（title_overridden = 1 表示自定义过）
 *   - created_at 取早的、updated_at 取晚的，让时间轴不回退
 *   - unread_at 一律不动，那是用户的阅读状态
 *   - searchable_text 只在目标行确实更旧时更新，避免新续写的内容被旧快照覆盖
 */
function writeTaskIndex(taskDb, plan) {
  const upsert = taskDb.prepare(`
    INSERT INTO tasks
      (workspace_key, workspace_path, workspace_identity, task_id, title,
       task_status, provider, mode, model, migration_source, forked_from_task_id,
       created_at, updated_at, unread_at, meta_json, searchable_text)
    VALUES
      (@workspace_key, @workspace_path, @workspace_identity, @task_id, @title,
       @task_status, @provider, @mode, @model, NULL, @forked_from_task_id,
       @created_at, @updated_at, @unread_at, @meta_json, @searchable_text)
    ON CONFLICT(workspace_key, task_id) DO UPDATE SET
      workspace_path = excluded.workspace_path,
      workspace_identity = excluded.workspace_identity,
      title = CASE
        WHEN tasks.title_overridden = 1 THEN tasks.title
        ELSE excluded.title
      END,
      task_status = excluded.task_status,
      provider = excluded.provider,
      mode = excluded.mode,
      model = excluded.model,
      migration_source = NULL,
      forked_from_task_id = excluded.forked_from_task_id,
      created_at = MIN(tasks.created_at, excluded.created_at),
      updated_at = MAX(tasks.updated_at, excluded.updated_at),
      unread_at = tasks.unread_at,
      searchable_text = CASE
        WHEN tasks.updated_at > excluded.updated_at THEN tasks.searchable_text
        ELSE excluded.searchable_text
      END,
      meta_json = excluded.meta_json
  `);

  upsert.run({
    workspace_key: plan.workspaceKey,
    workspace_path: plan.workspacePath,
    workspace_identity: plan.workspaceIdentity || null,
    task_id: plan.restoredTaskId,
    title: plan.title,
    task_status: asText(plan.meta.status) || null,
    provider: RESTORED_PROVIDER,
    mode: plan.mode,
    model: plan.model || null,
    forked_from_task_id: asText(plan.meta.forkedFromTaskId) || null,
    created_at: plan.createdAt,
    updated_at: plan.updatedAt,
    unread_at: asNumber(plan.meta.unreadAt) ?? null,
    meta_json: plan.metaJson,
    searchable_text: plan.searchableText,
  });
}

/**
 * session 表 upsert。
 *
 * `title_source = 'custom'` 是用户在会话列表里手改过标题的标记，此时同样不覆盖。
 * trace_id 用 COALESCE 保留已有的：任务可能先被别的地方写过 trace，回滚重放时
 * 换成新值会让链路断掉。
 */
function writeSession(cliDb, plan) {
  const upsert = cliDb.prepare(`
    INSERT INTO session
      (id, project_id, workspace_id, slug, directory, path, title, version,
       time_created, time_updated, task_type, title_source, trace_id)
    VALUES
      (@id, @project_id, @workspace_id, @slug, @directory, @path, @title, @version,
       @time_created, @time_updated, @task_type, @title_source, @trace_id)
    ON CONFLICT(id) DO UPDATE SET
      project_id = excluded.project_id,
      workspace_id = excluded.workspace_id,
      slug = excluded.slug,
      directory = excluded.directory,
      path = excluded.path,
      title = CASE
        WHEN session.title_source = 'custom' THEN session.title
        ELSE excluded.title
      END,
      version = excluded.version,
      time_created = MIN(session.time_created, excluded.time_created),
      time_updated = MAX(session.time_updated, excluded.time_updated),
      task_type = excluded.task_type,
      trace_id = COALESCE(session.trace_id, excluded.trace_id)
  `);

  upsert.run({
    id: plan.restoredTaskId,
    project_id: plan.projectId,
    workspace_id: plan.workspaceHash,
    slug: plan.restoredTaskId,
    directory: plan.workspacePath,
    path: plan.workspacePath,
    title: plan.title,
    version: SESSION_SCHEMA_VERSION,
    time_created: plan.createdAt,
    time_updated: plan.updatedAt,
    task_type: "interactive",
    title_source: "first_input",
    trace_id: plan.traceId,
  });
}

/**
 * message / part 两表写入。
 *
 * 先按 `part_legacy_<taskId>_%` 删掉旧 part 再重写，保证重复恢复不累积重复行。
 * message 用 INSERT OR REPLACE，但 data 里**不带**旧的身份字段——恢复脚本写的是当前
 * 消息契约，继续生成旧字段会迫使正常读取链依赖 legacy codec，并让新恢复的数据再次
 * 成为待迁移数据。
 */
function writeMessages(cliDb, plan) {
  const insertMessage = cliDb.prepare(`
    INSERT OR REPLACE INTO message
      (id, session_id, time_created, time_updated, data)
    VALUES
      (@id, @session_id, @time_created, @time_updated, @data)
  `);
  const insertPart = cliDb.prepare(`
    INSERT OR REPLACE INTO part
      (id, message_id, session_id, time_created, time_updated, data)
    VALUES
      (@id, @message_id, @session_id, @time_created, @time_updated, @data)
  `);
  const deleteLegacyParts = cliDb.prepare(`
    DELETE FROM part
    WHERE session_id = @session_id AND id LIKE @id_prefix
  `);

  let partCount = 0;
  let latestUserMessageId = "";
  const messages = plan.snapshot.messages;
  deleteLegacyParts.run({
    session_id: plan.restoredTaskId,
    id_prefix: `part_legacy_${plan.restoredTaskId}_%`,
  });

  for (const [index, message] of messages.entries()) {
    const messageTimestamp = asNumber(message.timestamp) ?? plan.updatedAt;
    const completedAt = messageCompletedAt(message, messageTimestamp);
    const messageId = `msg_legacy_${plan.restoredTaskId}_${index}`;
    const role = messageRole(message);
    const baseData = {
      role,
      time: compact({
        created: messageTimestamp,
        completed: role === "assistant" ? completedAt : undefined,
      }),
      agent: "zcode-agent",
    };

    const data =
      role === "assistant"
        ? {
            ...baseData,
            content: message.content,
            modelId: message.model || plan.model || "unknown",
            providerId: RESTORED_PROVIDER,
            mode: plan.mode,
            path: { cwd: plan.workspacePath, root: plan.workspacePath },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            finish: "stop",
            // 助手消息挂到最近一条用户消息下，保住对话 threading。没有前序用户消息时
            // 不写 parentID——写空串会让读取链按无效父ID去查。
            ...(latestUserMessageId ? { parentID: latestUserMessageId } : {}),
            ...(Array.isArray(message.tools) && message.tools.length > 0
              ? {
                  toolCalls: message.tools.map((tool, toolIndex) => ({
                    id: `tool_${messageId}_${toolIndex}`,
                    toolName: asText(tool.title) || "",
                    kind: asText(tool.kind) || "other",
                    status: asText(tool.status) || "completed",
                    input: tool.input || {},
                    output: asStoredText(tool.output),
                    ...(tool.raw ? { raw: tool.raw } : {}),
                  })),
                }
              : {}),
            ...(message.characterCount !== undefined
              ? { characterCount: message.characterCount }
              : {}),
            ...(message.turnIndex !== undefined ? { turnIndex: message.turnIndex } : {}),
          }
        : {
            ...baseData,
            content: message.content,
            modelSelection: {
              providerId: RESTORED_PROVIDER,
              modelId: message.model || plan.model || "unknown",
            },
            // 旧 Reader 无条件访问 User.model；显式导入绕过普通 Writer，也必须补最小对象，
            // 否则回滚后打不开正文。这里不复制模型身份：旧版允许模型失效但不能读取抛错。
            model: {},
            ...(message.characterCount !== undefined
              ? { characterCount: message.characterCount }
              : {}),
            ...(message.turnIndex !== undefined ? { turnIndex: message.turnIndex } : {}),
          };

    insertMessage.run({
      id: messageId,
      session_id: plan.restoredTaskId,
      time_created: messageTimestamp,
      time_updated: messageTimestamp,
      data: JSON.stringify(compact(data)),
    });

    for (const [partIndex, partData] of buildPartDataList(
      message,
      messageId,
      messageTimestamp,
    ).entries()) {
      // part 的 id 带消息序号与 part 序号，各补足 4 位：字典序即时间序，
      // 而 LIST 查询依赖这个顺序还原对话。
      const partId = `part_legacy_${plan.restoredTaskId}_${String(index).padStart(4, "0")}_${String(
        partIndex,
      ).padStart(4, "0")}`;
      const partTimestamp = messageTimestamp + partIndex;
      insertPart.run({
        id: partId,
        message_id: messageId,
        session_id: plan.restoredTaskId,
        time_created: partTimestamp,
        time_updated: partTimestamp,
        data: JSON.stringify(partData),
      });
      partCount += 1;
    }

    if (role === "user") latestUserMessageId = messageId;
  }

  return { messageCount: messages.length, partCount };
}

/** 把恢复计划落进两个库。调用方负责事务边界。 */
export function writeRestore(taskDb, cliDb, plan, log) {
  log("[1/2] Writing task index...");
  writeTaskIndex(taskDb, plan);
  log(`  tasks row ready: ${plan.restoredTaskId}`);

  log("[2/2] Writing CLI session DB...");
  writeSession(cliDb, plan);
  const result = writeMessages(cliDb, plan);
  log(`  message rows ready: ${result.messageCount}`);
  log(`  part rows ready:    ${result.partCount}`);
}
