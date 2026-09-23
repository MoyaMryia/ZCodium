# 机器人 AstrBot 桥接协议 v2（Bots ↔ AstrBot Bridge）

## 背景

官方 3.14.1 安装包内置 `bots`（Telegram/Feishu/Lark/WeCom 各一套 adapter）。
ZCodium 既定路线不是逐平台重写，而是用 AstrBot 做平台层，ZCodium 只暴露一份桥接协议。

v1 草案按“多平台各自配置 + 卡片交互”设计，经过对远程 AstrBot 4.26.3 的实测后收敛为 v2：

- AstrBot 已经实现飞书/Lark 的 WebSocket 长连、CardKit 流式卡片、富媒体、扫码建应用。
  这些**不需要 ZCodium 再做**，重复实现只会和 AstrBot 打架。
- AstrBot 插件天然是“收到消息 → 产出回复”的 handler 模型，最适合的接口是
  **同步轮次 + 流式文本**，而不是 ZCodium 主动广播事件。
- AstrBot 的 Lark 适配器**没有**注册卡片按钮回调（`card.action.trigger`），
  所以交互只能用**文本命令**，不设计按钮。

结论：ZCodium bridge v2 = 面向 AstrBot 插件的**单条 loopback WebSocket + 轮次流**。

## 范围

### 纳入

- 单桥接连接（AstrBot 插件作为唯一客户端），Bearer token 鉴权，loopback WS。
- 绑定：`(channel, externalUserId)` → ZCodium workspace / session。
- 轮次（turn）：客户端发 `prompt`，服务端流式回 `text` / `tool` / `changes` / `notice`
  / `permission` / `elicitation` / `selection`，以 `status` 帧收口。
- 文本命令交互：权限与 elicitation 以文本选项下发，用户回复命令后由插件转成
  `permission.respond` / `elicitation.respond`。
- 断线重连 + 有限回放；超窗发 snapshot。

### 排除（交给 AstrBot）

- 平台 SDK、长连、卡片 JSON、富媒体上传、扫码建应用、打字指示、分段/流式渲染。
- 多平台 provider 抽象：ZCodium 只认 `channel` 字符串，不感知协议差异。
- 卡片按钮、表单提交（AstrBot Lark 适配器不可达）。
- 官方 `bots.*` 的 258 个 i18n key。

## 状态所有者

| 状态 | 所有者 | 说明 |
| --- | --- | --- |
| bridge 配置（`bots-bridge.v2.json`） | ZCodium `BotsRepo` | enabled、默认 allowedWorkspaces、bridge token 引用 |
| 绑定（`bots-bindings.v2.json`） | ZCodium `BotsRepo` | `actorKey → {workspace, sessionId, pending 交互, cursor}` |
| bridge token | ZCodium credential store | key `bot:bridge:token`，只展示一次 |
| 轮次流（streamId/seq） | ZCodium `BotsService`（内存 + 有限落盘游标） | 插件只去重，不产生事实 |
| 待处理权限/elicitation | ZCodium `BotsService` | 来自 runtime 事件，唯一所有者 |
| AstrBot 侧事件、卡片、消息 id | AstrBot 插件 | 不进入 ZCodium 持久化 |
| Agent 会话与任务 | 现有 `IZCodeTaskService` + `SessionRealtimePort` | bridge 不另建任务状态 |

**唯一写入路径**：`BotsService` 写配置/绑定/游标；插件只发命令、只 ack。
Agent 控制走既有 `IZCodeTaskService.sendPrompt` 与 `SessionRealtimePort.requestOwnerCommand`。

## 组件

```text
packages/shared/src/bots/bridge.ts        v2 协议契约（zod），无 IO
packages/services/src/bots/
  domain.ts                               bridge 配置 + 绑定领域模型
  botsRepo.ts                             原子写 + 串行锁
  botsDeliveryLog.ts                      轮次流 seq / 有限回放
  botsRuntimePort.ts                      对 IZCodeTaskService + SessionRealtimePort 的适配接口
  botsEventProjector.ts                   TaskStreamMirrorableEvent → delivery payload
  botsService.ts                          绑定、轮次状态机、命令准入、交互
packages/desktop/src/host/
  botsBridgeServer.ts                     loopback WS + token 鉴权 + 帧路由
  botsRuntimeAdapter.ts                   把 host 的 taskService/realtimePort 接成 BotsRuntimePort
astrbot-zcodium-plugin（独立仓库，Python）
  main.py                                 Star 插件：收消息 → prompt → send_streaming
```

依赖方向：shared → services → desktop；插件只按协议收发 JSON，不 import ZCodium。

## 传输

- `127.0.0.1` loopback WebSocket，路径 `/bots/bridge/v2`，端口 `0`（临时端口）。
- 端口与 token 写入 `bots-bridge.v2.json`（数据目录，0600），用户复制到插件配置。
- 握手：`Authorization: Bearer <token>`；失败直接关闭，不泄露任何信息。
- UTF-8 JSON 文本帧，每帧一个对象，`v` 版本协商。

### 帧

```text
client→server  hello      握手（clientId / channels / resume 游标）
client→server  command    用户输入或交互应答
client→server  ack        确认收到 delivery
server→client  welcome    握手结果
server→client  accepted   命令已受理，附 streamId
server→client  delivery   轮次流中的一条输出
server→client  status     轮次流终止（completed/failed/stopped/awaiting_input）
server→client  error      协议级错误
```

公共字段：`{ v: 2, kind, id }`；`id` 由发送方生成，对端在 `inReplyTo` 回传。

## 轮次模型

```text
插件收到平台消息
  → command{ prompt, actor, text }
  → accepted{ streamId }
  → delivery (text/tool/changes/notice...) ...   // 顺序 seq = 1..n
  → status{ state }
      ├─ completed / failed / stopped   → 本轮结束
      └─ awaiting_input                 → 有 permission/elicitation，等用户文本命令
用户回复命令（插件解析）
  → command{ permission.respond | elicitation.respond, requestId, ... }
  → accepted{ 新的 streamId } → delivery ... → status
```

- `accepted` 之后同一 `streamId` 的 `delivery` 按 `seq` 单调有序；`status` 是终止符。
- 每轮是独立的 request/response 流，插件对每个 `command` 调一次 `event.send_streaming`。
- `awaiting_input` 时服务端保留 pending 交互；插件把选项渲染成文本并结束本次流，
  用户下一条消息触发对应 `*.respond`，继续原任务。

### delivery payload

| type | 字段 | 插件动作 |
| --- | --- | --- |
| `text` | `text`, `replace?` | 追加/替换助手正文；喂给 `send_streaming` |
| `tool` | `toolId`, `title`, `status`, `summary?` | 工具进度行；可作为 `break` 边界 |
| `changes` | `fileCount`, `files[{path,additions,deletions}]` | 变更摘要文本 |
| `notice` | `level`, `message` | 提示/错误 |
| `selection` | 见下 | 交互（权限/提问/菜单），插件打印 `text` |

`selection` 对齐官方抽象：

```text
{
  type: "selection",
  selectionId, title,
  text,                       // canonical 渲染：每个选项“序号. 标签”+ 对应命令
  options: [{ id, label, description? }],
  action,                     // "permission.respond" | "elicitation.respond" | ...
  requestId?, token?,         // 权限 requestId；提问 anti-replay token
  cancelLabel?, showCancel?,
  meta?: { kind, currentQuestionIndex?, total?, multiSelect?, status?, planApproval? }
}
```

- `options[].id` 是运行时口径的选中值（permission 为 `optionId`，elicitation 为 `option.value`）。
- `text` 是纯文本平台唯一需要渲染的内容；结构化字段留给程序化客户端 / 未来的 AstrBot 卡片。

### command

| type | 字段 | ZCodium 动作 |
| --- | --- | --- |
| `prompt` | `text` | **文本原样透传**，由 ZCodium 集中解析（见下） |
| `bind` | `code` | 消费绑定码，建立绑定 |
| `unbind` | — | 解除绑定 |
| `new` | — | 新建 session（保留 workspace） |
| `stop` | — | `requestOwnerCommand(stop_generation)` |
| `cancel` | — | 取消当前待处理交互 |
| `status` | — | 回当前绑定/任务状态 |
| `help` | — | 回文本帮助 |
| `workspace.set` | `value` | 校验 allowedWorkspaces 后切换 |
| `permission.respond` | `requestId`, `optionId` | `requestOwnerCommand(respond_permission)`（结构化旁路） |
| `elicitation.respond` | `requestId`, `token?`, `action`, `content?` | `requestOwnerCommand(respond_elicitation)`（结构化旁路） |

### 集中文本解析（对齐官方 `parseBotCommand`）

插件默认只发 `prompt`；ZCodium 在 host 侧解析。全部命令**带 `/` 前缀**（无斜杠的 `0` = 取消）：

```text
/bind <code>   /help|帮助   /cancel|取消   /status|状态   /new|clear|新建
/reconnect|重连   /workspace|project|项目 [序号]
/stop|停止   /unbind
/permission <序号>   /approve <requestId> <optionId>   /deny <requestId>
/elicitation|answer|回答 <token> <序号|值|submit>
```

- `/permission` 的 `<序号>` 是 canonical 文本里的 1-based 序号；也接受 `optionId`/label。
- 非命令文本直接进 agent；pending 交互存在时，只有上述匹配命令才当应答。

### elicitation 逐题推进

- 服务端 pending 保存 `{questions, currentQuestionIndex, answers, token}`。
- 单选：选完当前题 → `currentQuestionIndex+1` 重发下一题；最后一题才提交。
- 多选：回复选项切换 `[x]/[ ]` 并重发；`/elicitation <token> submit` 提交。
- 提交时 `content = { answer_0: [...], answer_1: [...] }`，`action=accept`。
- `token` 必须匹配，防旧消息串台。

## 幂等与恢复

- `commandId` 去重；重复命令返回首次 `accepted`/结果，不重复执行。
- 下行按 `(bindingId, streamId, seq)` 去重；插件 ack 后可丢弃。
- 重连：`hello.resume = [{bindingId, seq}]`。窗口内补 `delivery`；超窗发
  `status{state:"awaiting_input"|snapshot}` + 当前 pending 交互，保证不丢权限等待。
- 权限/elicitation 的 `requestId` 来自 runtime，原样回传。
- 桥接不参与 run owner/lease；owner/lease、stale run 防护仍由 `SessionRealtimePort` 决定。

## 失败语义

- token 无效：关闭连接，`warn` 日志，不下发任何 payload。
- 未绑定且有 pending 权限：回 `notice` 提示先绑定。
- `allowedCommands`/`allowedWorkspaces` 不允许：`status{state:"failed"}` 或 `error`，不改任务状态。
- owner command 落空：映射 `NO_ACTIVE_TASK_OWNER` / `STALE_TASK_OWNER_COMMAND` 到 `error`。
- 插件未连接：不无限排队；每绑定保留有限窗口（默认 200 条）。

## 验收场景

1. 错误 token 握手被拒，日志/响应不含 token。
2. `prompt` → `accepted` → 有序 `delivery` → `status{completed}`；正文完整。
3. 工具调用期间 `tool` delivery 顺序正确，正文分段与最终文本一致。
4. 触发权限：收到 `permission` + `status{awaiting_input}`；`permission.respond` 后原任务继续并收口。
5. `elicitation.respond` 同理；`requestId` 原样回传。
6. 同一 `commandId` 重发只执行一次。
7. 断开重连后窗口内补投；超窗收到 snapshot/pending，权限等待不丢。
8. 未绑定用户发消息：不建任务，只回绑定提示。
9. `allowedWorkspaces` 外的 `workspace.set` 被拒。
10. 群聊按 `channel + 用户 id` 绑定，私聊按 `channel + 用户 id`，互不串。

## 迁移边界

- v1 草案（`bot-config.v3.json` / `bot-bindings` 多 bot 模型）作废，不做迁移；首次启动写空 v2 配置。
- 不兼容官方 `bot-config` 文件；存在时只备份不读取。
- 协议升级递增 `v`，双版本共存期后才移除旧路径。

## 分期

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | v2 协议契约 + 帧校验 | typecheck/lint |
| P2 | `BotsRepo` + `BotsService`（绑定、轮次状态机、文本交互） | 场景 6/8/9/10 |
| P3 | `BotsRuntimePort` 适配 + `BotsEventProjector` 事件投影 | 场景 2/3/4/5 |
| P4 | host WS `botsBridgeServer` 接 v2 帧 + 补投 | 场景 1/7 |
| P5 | `astrbot-zcodium-plugin`：Star 插件 → bridge → `send_streaming` | 端到端 |
| P6 | 设置 UI（bridge 开关/token/绑定管理） | 场景 1 |
