/* oxlint-disable eslint(max-lines) -- 机器人桥接领域模型集中维护，schema 与派生 helper 就近。 */
// 机器人桥接领域模型 v2。见 .agents/specs/bots-astrbot-bridge.md。
//
// 单桥接连接（AstrBot 插件）；绑定按 (channel, externalUserId) 隔离。
// 本文件只放纯类型、schema 与不依赖 IO 的派生逻辑。

import { createHash } from "node:crypto";
import { z } from "zod";

export const BOTS_BRIDGE_CONFIG_VERSION = 2 as const;
export const BOTS_BINDINGS_VERSION = 2 as const;

const nonEmpty = z.string().trim().min(1);
const timestampMs = z.number().int().nonnegative();

/** 全局通配：绑定可使用所有已配置 workspace。 */
export const BOTS_ALL_WORKSPACES = "*" as const;

export const botsBridgeConfigSchema = z
  .object({
    version: z.literal(BOTS_BRIDGE_CONFIG_VERSION),
    enabled: z.boolean(),
    /** 新绑定默认允许的 workspace；`*` 表示全部。 */
    allowedWorkspaces: z.array(nonEmpty),
    /** bridge token 在 credential store 中的 key。 */
    tokenCredentialRef: nonEmpty.optional(),
  })
  .strict();
export type BotsBridgeConfig = z.infer<typeof botsBridgeConfigSchema>;

export function createDefaultBotsBridgeConfig(): BotsBridgeConfig {
  // 默认启用：bridge 只监听 loopback + token 鉴权，且首个绑定码由 host 写入运行时文件。
  return {
    version: BOTS_BRIDGE_CONFIG_VERSION,
    enabled: true,
    allowedWorkspaces: [BOTS_ALL_WORKSPACES],
  };
}

/** 绑定上半条的 workspace 目标；与 `workspaceIdentity` 规则一致。 */
export const botsBindingTargetSchema = z
  .object({
    workspacePath: nonEmpty,
    workspaceIdentity: nonEmpty.optional(),
  })
  .strict();
export type BotsBindingTarget = z.infer<typeof botsBindingTargetSchema>;

/** 待处理交互（官方 selection 抽象的服务端快照）。 */
export const botsPendingSelectionSchema = z
  .object({
    kind: z.enum(["permission", "elicitation"]),
    requestId: nonEmpty,
    selectionId: nonEmpty,
    token: nonEmpty.optional(),
    action: nonEmpty,
    title: z.string(),
    options: z.array(
      z.object({ id: nonEmpty, label: nonEmpty, description: z.string().optional() }).strict(),
    ),
    questions: z
      .array(
        z
          .object({
            index: z.number().int().nonnegative(),
            question: z.string(),
            header: z.string().optional(),
            multiSelect: z.boolean().optional(),
            options: z.array(z.object({ value: nonEmpty, label: nonEmpty }).strict()),
          })
          .strict(),
      )
      .optional(),
    currentQuestionIndex: z.number().int().nonnegative().optional(),
    answers: z.record(z.string(), z.array(z.string())).optional(),
    /** permission 的 optionId → 运行时应答体。 */
    responses: z.record(z.string(), z.unknown()).optional(),
    taskId: nonEmpty,
    runId: nonEmpty.optional(),
    handledAt: timestampMs.optional(),
  })
  .strict();
export type BotsPendingSelection = z.infer<typeof botsPendingSelectionSchema>;

export const botsBindingSchema = z
  .object({
    bindingId: nonEmpty,
    channel: nonEmpty,
    actorKey: nonEmpty,
    externalUserId: nonEmpty,
    chatType: z.enum(["private", "group"]),
    chatId: nonEmpty.optional(),
    displayName: z.string().optional(),
    allowedWorkspaces: z.array(nonEmpty),
    target: botsBindingTargetSchema,
    sessionId: nonEmpty,
    runId: nonEmpty.optional(),
    mode: z.enum(["idle", "running", "awaiting_input"]),
    pending: botsPendingSelectionSchema.optional(),
    /** 最近一次已 ack 的下行 seq，用于重连补投判定。 */
    deliveryCursor: z.number().int().nonnegative(),
    createdAt: timestampMs,
    updatedAt: timestampMs,
  })
  .strict();
export type BotsBinding = z.infer<typeof botsBindingSchema>;

export const botsBindingsSchema = z
  .object({
    version: z.literal(BOTS_BINDINGS_VERSION),
    bindings: z.array(botsBindingSchema),
  })
  .strict();
export type BotsBindings = z.infer<typeof botsBindingsSchema>;

export function createDefaultBotsBindings(): BotsBindings {
  return { version: BOTS_BINDINGS_VERSION, bindings: [] };
}

/**
 * actorKey 用平台稳定用户 id 派生，不落明文 id。
 * 群聊与私聊使用同一 key（同一用户在多处是同一主体）；如需隔离可用 chatId 扩展。
 */
export function computeActorKey(channel: string, externalUserId: string): string {
  return createHash("sha256").update(`${channel}\u0000${externalUserId.trim()}`).digest("hex");
}

export function buildBindingId(channel: string, actorKey: string): string {
  return `${channel}:${actorKey.slice(0, 16)}`;
}

export function isAllWorkspacesAllowed(allowedWorkspaces: readonly string[]): boolean {
  return allowedWorkspaces.length === 0 || allowedWorkspaces.includes(BOTS_ALL_WORKSPACES);
}

export function normalizeAllowedWorkspaces(allowedWorkspaces: readonly string[]): string[] {
  const normalized = allowedWorkspaces.map((value) => value.trim()).filter(Boolean);
  if (isAllWorkspacesAllowed(normalized)) {
    return [BOTS_ALL_WORKSPACES];
  }
  return [...new Set(normalized)];
}

export function isWorkspaceAllowed(
  allowedWorkspaces: readonly string[],
  workspaceKey: string,
): boolean {
  return isAllWorkspacesAllowed(allowedWorkspaces) || allowedWorkspaces.includes(workspaceKey);
}

export function workspaceKeyOf(target: BotsBindingTarget): string {
  return target.workspaceIdentity?.trim() || target.workspacePath;
}
