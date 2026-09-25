// ============================================================
// child runtime 的「对外交互」端口派生（唯一出口）
// ============================================================
//
// 子 runtime 有两条会话身份轴：
//   账本身份 sessionId —— 事件持久化 / transcript / trace / session store，子用自己的；
//   路由身份         —— 一切 agent → app 反向请求（permission、AskUserQuestion），子必须用父的，直到根会话。
// 客户端只认识根会话；拿子会话去问，桌面侧找不到 session，response 永不发出，子代理挂死。
//
// 过去这条规则散在各 child 装配点：core 的 subagent 包了两层私有 wrapper，dwf actor 与 legacy
// workflow child 直接透传 appOptions 的端口——于是两处错、一处对。这里把派生收敛成一处，并由
// **父 runtime** 调用（`AgentRuntime.createChildClientPorts`），`parentSessionId` 由父自己填，
// 调用方给不了错的值。

import type { PermissionBrokerPort, SessionId } from "../deps.js";
import type { SubagentInteractionOriginContext } from "../../subagent/interaction-origin.js";
import { createSubagentInteractionBroker } from "./subagent-interaction-broker.js";

/** 一个 runtime 面向协议客户端的端口集合。 */
export interface ClientFacingPorts {
  permissionBroker?: PermissionBrokerPort;
}

/**
 * 铸造一个 child 所需的归属信息。`parentSessionId` 不在这里——它只能由父 runtime 提供，
 * 这正是「路由身份选不错」的机械保证。
 */
export type ChildClientPortsContext = Omit<SubagentInteractionOriginContext, "parentSessionId">;

/**
 * 由父的对外端口派生子的对外端口。
 *
 * - `permissionBroker`：包一层改写 `request.sessionId`，同样外层后写；`origin` 则保留最内层已有值，
 *   子代理归属不被外层抹掉。
 */
export function deriveChildClientPorts(
  parent: ClientFacingPorts,
  context: ChildClientPortsContext & { parentSessionId: SessionId },
): ClientFacingPorts {
  return parent.permissionBroker === undefined
    ? {}
    : { permissionBroker: createSubagentInteractionBroker(parent.permissionBroker, context) };
}
