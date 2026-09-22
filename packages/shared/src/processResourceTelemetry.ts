/**
 * 全进程 CPU / 内存诊断的共享契约。
 *
 * 这里只放"main 与单测都要用同一份"的常量与纯校验：进程角色枚举、采样节拍与 lane 归属。真正的采样与聚合在 desktop main 侧。
 */

/** 第一期 10 个进程角色。 */
export const PROCESS_RESOURCE_ROLES = [
  "main",
  "renderer_main",
  "renderer_guest",
  "gpu",
  "chromium_other",
  "host",
  "scheduler",
  "cli_chat",
  "cli_aux",
  "mcp",
] as const;

export type ProcessResourceRole = (typeof PROCESS_RESOURCE_ROLES)[number];

/**
 * zcode-cli 的自采周期，是 CLI 与 app 之间的节拍契约：
 * CLI 侧是定时器周期，main 侧既是「多久算一个 CLI 样本」也是过期判据（2 个周期）的基数。
 * 两侧必须同源，否则改 CLI 节拍会让 main 的 `sample_count` 静默偏离约定值。
 */
export const ZCODE_CLI_RESOURCE_SAMPLE_INTERVAL_MS = 60_000;

/**
 * zcode-cli 的进程泳道。
 *
 * lane 不是 CLI 协议字段——CLI 进程不知道自己被哪个进程管理器拉起，由 app 侧 services 层
 * 在解析样本时按所属进程管理器打标（`chat` 是 workspace 级 Agent，其余两条是控制面 lane）。
 */
export const PROCESS_RESOURCE_CLI_LANES = ["chat", "plugin", "mcp-status"] as const;

export type ProcessResourceCliLane = (typeof PROCESS_RESOURCE_CLI_LANES)[number];

/**
 * lane → 角色：`chat` 归 `cli_chat`（每 workspace 一个进程），其余两条 lane 合并为 `cli_aux`。
 *
 * 缺省（无 lane）归 `cli_chat`：唯一可能来源是版本落后、还没给样本打 lane 的远端 server，
 * 而远端 workspace 上长期存活并产生资源占用的是 chat lane；归到 cli_chat 比整条样本丢弃更接近事实。
 */
export function resolveCliProcessResourceRole(
  lane: ProcessResourceCliLane | undefined,
): Extract<ProcessResourceRole, "cli_chat" | "cli_aux"> {
  return lane === undefined || lane === "chat" ? "cli_chat" : "cli_aux";
}

/** 进程实际运行的位置；远端 CLI / MCP 的样本自带 remote。 */
export type ProcessResourceRuntimeSurface = "local" | "remote";
