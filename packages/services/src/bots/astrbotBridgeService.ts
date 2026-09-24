/* oxlint-disable eslint(max-lines) -- 桥接服务编排集中维护：绑定、轮次、交互、命令解析。 */
// 机器人桥接服务 v2。见 .agents/specs/bots-astrbot-bridge.md。
//
// 对齐官方 ZCode：host 集中解析用户文本（parseBotText），交互用 selection 抽象，
// elicitation 逐题推进、最后一起提交。插件只做文本透传与打印。

import { randomUUID } from "node:crypto";
import {
  BOTS_BRIDGE_PROTOCOL_VERSION,
  type BotsBridgeActor,
  type BotsBridgeCommand,
  type BotsBridgeCommandFrame,
  type BotsBridgeDeliveryFrame,
  type BotsBridgeDeliveryPayload,
  type BotsBridgeErrorFrame,
  type BotsBridgeResumeCursor,
  type BotsBridgeSelectionPayload,
  type BotsBridgeServerFrame,
  type BotsBridgeStreamState,
  type ZCodeStreamEvent,
} from "@zcode/shared";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";
import { BotsDeliveryLog, type BotsDeliveryReplay } from "./botsDeliveryLog.js";
import type { BotsRepo } from "./botsRepo.js";
import { projectTaskStreamEvent } from "./botsEventProjector.js";
import {
  buildElicitationSelection,
  buildPermissionSelection,
  type BotsElicitationDescriptor,
  type BotsInteractionDescriptor,
} from "./botsInteraction.js";
import type { BotsRuntimePort, BotsWorkspaceRef } from "./botsRuntimePort.js";
import {
  BOTS_ALL_WORKSPACES,
  buildBindingId,
  computeActorKey,
  createDefaultBotsBindings,
  isWorkspaceAllowed,
  normalizeAllowedWorkspaces,
  workspaceKeyOf,
  type BotsBinding,
  type BotsBridgeConfig,
  type BotsPendingSelection,
} from "./domain.js";

export interface BotsBindCode {
  code: string;
  allowedWorkspaces: string[];
  expiresAt: number;
}

export interface AstrBotBridgeServiceOptions {
  repo: BotsRepo;
  runtime: BotsRuntimePort;
  logger?: ServiceLogger;
  clock?: () => number;
  idFactory?: () => string;
}

const DEFAULT_BIND_CODE_TTL_MS = 10 * 60 * 1000;
const SUBMIT_TOKENS = new Set(["submit", "done", "完成", "提交"]);

interface ParsedBotText {
  name: string;
  rest: string;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 对齐官方 splitCommand：仅识别带 `/` 前缀的命令。 */
function splitBotCommand(text: string): ParsedBotText | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const body = trimmed.slice(1);
  const match = /\s/u.exec(body);
  if (!match) {
    return { name: body.toLowerCase(), rest: "" };
  }
  const index = match.index;
  return {
    name: body.slice(0, index).toLowerCase(),
    rest: body.slice(index + 1).trim(),
  };
}

export class AstrBotBridgeService {
  private readonly logger: ServiceLogger;
  private readonly clock: () => number;
  private readonly idFactory: () => string;
  private readonly bindCodes = new Map<string, BotsBindCode>();
  private readonly deliveryLog: BotsDeliveryLog;
  private readonly bindings = new Map<string, BotsBinding>();
  private readonly activeStreams = new Map<string, string>();
  private readonly frameListeners = new Set<(frame: BotsBridgeServerFrame) => void>();
  private loaded = false;
  private runtimeSubscription: { dispose(): void } | null = null;

  constructor(private readonly options: AstrBotBridgeServiceOptions) {
    this.logger = options.logger ?? createServiceLogger("bots");
    this.clock = options.clock ?? (() => Date.now());
    this.idFactory = options.idFactory ?? (() => randomUUID());
    this.deliveryLog = new BotsDeliveryLog({ idFactory: this.idFactory, clock: this.clock });
  }

  start(): void {
    if (!this.runtimeSubscription) {
      this.runtimeSubscription = this.options.runtime.onDidReceiveEvent((event) => {
        try {
          this.handleRuntimeEvent(event);
        } catch (error) {
          this.logger.warn(undefined, `bot runtime event failed: ${formatError(error)}`);
        }
      });
    }
  }

  dispose(): void {
    this.runtimeSubscription?.dispose();
    this.runtimeSubscription = null;
  }

  // ── 配置 / 绑定 ─────────────────────────────────────────

  async getConfig(): Promise<BotsBridgeConfig> {
    return this.options.repo.readConfig();
  }

  async saveConfig(config: BotsBridgeConfig): Promise<BotsBridgeConfig> {
    return this.options.repo.writeConfig(config);
  }

  async listWorkspaces(): Promise<BotsWorkspaceRef[]> {
    return this.options.runtime.listWorkspaces();
  }

  async listBindings(): Promise<BotsBinding[]> {
    await this.ensureLoaded();
    return [...this.bindings.values()];
  }

  async createBindCode(input?: {
    allowedWorkspaces?: string[];
    ttlMs?: number;
  }): Promise<{ code: string; expiresAt: number }> {
    const code = this.idFactory().replace(/-/gu, "").slice(0, 12);
    const expiresAt = this.clock() + (input?.ttlMs ?? DEFAULT_BIND_CODE_TTL_MS);
    this.bindCodes.set(code, {
      code,
      allowedWorkspaces: normalizeAllowedWorkspaces(
        input?.allowedWorkspaces ?? [BOTS_ALL_WORKSPACES],
      ),
      expiresAt,
    });
    return { code, expiresAt };
  }

  async unbind(bindingId: string): Promise<void> {
    await this.ensureLoaded();
    this.bindings.delete(bindingId);
    this.activeStreams.delete(bindingId);
    this.deliveryLog.drop(bindingId);
    await this.persistBindings();
  }

  onFrame(listener: (frame: BotsBridgeServerFrame) => void): { dispose(): void } {
    this.frameListeners.add(listener);
    return { dispose: () => this.frameListeners.delete(listener) };
  }

  ackDelivery(input: { bindingId: string; seq: number }): void {
    this.deliveryLog.ack(input.bindingId, input.seq);
    this.advanceCursor(input.bindingId, input.seq);
  }

  ackDeliveryByFrameId(deliveryId: string): void {
    const hit = this.deliveryLog.ackById(deliveryId);
    if (hit) {
      this.advanceCursor(hit.bindingId, hit.seq);
    }
  }

  resolveResume(cursors: readonly BotsBridgeResumeCursor[]): Map<string, BotsDeliveryReplay> {
    return this.deliveryLog.resolveResume(cursors);
  }

  async buildSnapshot(bindingId: string): Promise<BotsBridgeDeliveryFrame | null> {
    await this.ensureLoaded();
    const binding = this.bindings.get(bindingId);
    if (!binding) {
      return null;
    }
    const payload: BotsBridgeDeliveryPayload = binding.pending
      ? this.pendingSelectionPayload(binding.pending)
      : { type: "notice", level: "info", message: "已连接。" };
    return {
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "delivery",
      id: this.idFactory(),
      bindingId,
      streamId: `snapshot-${this.idFactory()}`,
      seq: binding.deliveryCursor + 1,
      createdAt: this.clock(),
      payload,
    };
  }

  // ── 命令准入 ────────────────────────────────────────────

  async handleCommand(frame: BotsBridgeCommandFrame): Promise<void> {
    const actorKey = computeActorKey(frame.actor.channel, frame.actor.externalUserId);
    const bindingId = buildBindingId(frame.actor.channel, actorKey);
    try {
      await this.ensureLoaded();
      const config = await this.options.repo.readConfig();
      if (!config.enabled) {
        this.emitError(frame.id, "BRIDGE_DISABLED", "ZCodium bridge 未启用。");
        return;
      }
      if (frame.command.type === "bind") {
        await this.handleBind(frame, frame.actor, actorKey, bindingId, config);
        return;
      }
      const binding = this.bindings.get(bindingId);
      if (!binding) {
        this.emitError(frame.id, "NOT_BOUND", "当前会话尚未绑定 ZCode，请先发送 /bind <code>。");
        return;
      }
      await this.dispatch(frame, binding, frame.command);
    } catch (error) {
      this.logger.warn(undefined, `handle bridge command failed: ${formatError(error)}`);
      this.emitError(frame.id, "COMMAND_FAILED", formatError(error));
    }
  }

  private async handleBind(
    frame: BotsBridgeCommandFrame,
    actor: BotsBridgeActor,
    actorKey: string,
    bindingId: string,
    config: BotsBridgeConfig,
  ): Promise<void> {
    if (actor.chatType !== "private") {
      this.emitError(frame.id, "BIND_REQUIRES_PRIVATE_CHAT", "请在机器人私聊中发送绑定命令。");
      return;
    }
    const code = frame.command.type === "bind" ? this.bindCodes.get(frame.command.code) : undefined;
    if (!code || code.expiresAt <= this.clock()) {
      this.emitError(frame.id, "BIND_CODE_INVALID", "绑定码无效或已过期。");
      return;
    }
    this.bindCodes.delete(code.code);
    const target = (await this.options.runtime.listWorkspaces())[0];
    if (!target) {
      this.emitError(frame.id, "NO_WORKSPACE", "没有可用的 workspace。");
      return;
    }
    const now = this.clock();
    const binding: BotsBinding = {
      bindingId,
      channel: actor.channel,
      actorKey,
      externalUserId: actor.externalUserId,
      chatType: actor.chatType,
      ...(actor.chatId ? { chatId: actor.chatId } : {}),
      ...(actor.displayName ? { displayName: actor.displayName } : {}),
      allowedWorkspaces:
        code.allowedWorkspaces.length > 0 ? code.allowedWorkspaces : config.allowedWorkspaces,
      target: {
        workspacePath: target.workspacePath,
        ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      },
      sessionId: "",
      mode: "idle",
      deliveryCursor: 0,
      createdAt: now,
      updatedAt: now,
    };
    const session = await this.options.runtime.createSession({
      binding,
      target: binding.target,
      forceNew: false,
    });
    binding.sessionId = session.sessionId;
    this.bindings.set(bindingId, binding);
    await this.persistBindings();
    this.logger.info(undefined, `bot binding created binding=${bindingId}`);
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
    await this.pushNotice(binding, "info", `绑定成功，工作区：${target.label}。`);
  }

  private async dispatch(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    command: BotsBridgeCommand,
  ): Promise<void> {
    switch (command.type) {
      case "prompt":
        await this.handlePromptText(frame, binding, command.text);
        return;
      case "cancel":
        await this.handleCancel(frame, binding);
        return;
      case "unbind":
        await this.unbind(binding.bindingId);
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        return;
      case "new":
        await this.startTurn(frame, binding, "", { forceNew: true });
        return;
      case "stop":
        await this.handleStop(frame, binding);
        return;
      case "status":
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        await this.pushNotice(
          binding,
          "info",
          binding.mode === "running" ? "任务运行中。" : "空闲。",
        );
        return;
      case "help":
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        await this.pushNotice(binding, "info", HELP_TEXT);
        return;
      case "workspace.set":
        await this.handleWorkspaceSet(frame, binding, command.value);
        return;
      case "permission.respond":
        await this.respondPermission(frame, binding, command.requestId, command.optionId);
        return;
      case "elicitation.respond":
        await this.respondElicitation(
          frame,
          binding,
          command.requestId,
          command.action,
          command.content,
        );
        return;
      default:
        this.emitError(frame.id, "NOT_IMPLEMENTED", `命令 ${command.type} 尚未接入。`);
    }
  }

  /** 官方 parseBotCommand 的等价物：集中解析文本。 */
  private async handlePromptText(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    text: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === "0") {
      await this.handleCancel(frame, binding);
      return;
    }
    const parsed = splitBotCommand(trimmed);
    if (!parsed) {
      await this.startTurn(frame, binding, text, { forceNew: false });
      return;
    }
    const { name, rest } = parsed;
    switch (name) {
      case "new":
      case "clear":
      case "新建":
        await this.startTurn(frame, binding, "", { forceNew: true });
        return;
      case "stop":
      case "停止":
      case "abort":
        await this.handleStop(frame, binding);
        return;
      case "cancel":
      case "取消":
        await this.handleCancel(frame, binding);
        return;
      case "workspace":
      case "project":
      case "项目":
        if (rest) {
          await this.handleWorkspaceSet(frame, binding, rest);
        } else {
          await this.sendWorkspaceList(frame, binding);
        }
        return;
      case "bind":
        this.emitError(frame.id, "ALREADY_BOUND", "当前会话已绑定。");
        return;
      case "unbind":
        await this.unbind(binding.bindingId);
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        return;
      case "status":
      case "状态":
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        await this.pushNotice(
          binding,
          "info",
          binding.mode === "running" ? "任务运行中。" : "空闲。",
        );
        return;
      case "help":
      case "帮助":
        this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
        await this.pushNotice(binding, "info", HELP_TEXT);
        return;
      case "permission":
        await this.handlePermissionText(frame, binding, rest);
        return;
      case "approve": {
        const [requestId, optionId] = rest.split(/\s+/u);
        if (requestId && optionId) {
          await this.respondPermission(frame, binding, requestId, optionId);
        } else {
          this.emitError(frame.id, "BAD_COMMAND", "用法：/approve <requestId> <optionId>");
        }
        return;
      }
      case "deny":
        await this.handleDenyText(frame, binding, rest);
        return;
      case "elicitation":
      case "answer":
      case "回答":
        await this.handleElicitationText(frame, binding, rest);
        return;
      default:
        // 其余 /xxx 交给 agent（可能是自定义命令）。
        await this.startTurn(frame, binding, text, { forceNew: false });
    }
  }

  // ── 交互应答 ────────────────────────────────────────────

  private async handlePermissionText(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    rest: string,
  ): Promise<void> {
    const pending = binding.pending;
    if (!pending || pending.kind !== "permission") {
      this.emitError(frame.id, "NO_PENDING_PERMISSION", "当前没有待处理的权限请求。");
      return;
    }
    const option = this.resolveSelectionOption(pending, rest);
    if (!option) {
      this.emitError(frame.id, "BAD_OPTION", "无法识别选项。");
      return;
    }
    await this.respondPermission(frame, binding, pending.requestId, option.id);
  }

  private async handleDenyText(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    requestId: string,
  ): Promise<void> {
    const pending = binding.pending;
    if (
      !pending ||
      pending.kind !== "permission" ||
      (requestId && requestId !== pending.requestId)
    ) {
      this.emitError(frame.id, "NO_PENDING_PERMISSION", "当前没有待处理的权限请求。");
      return;
    }
    const deny =
      pending.options.find((option) => option.label.includes("拒绝")) ?? pending.options.at(-1);
    if (!deny) {
      this.emitError(frame.id, "BAD_OPTION", "没有可用的拒绝选项。");
      return;
    }
    await this.respondPermission(frame, binding, pending.requestId, deny.id);
  }

  private async handleElicitationText(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    rest: string,
  ): Promise<void> {
    const pending = binding.pending;
    if (!pending || pending.kind !== "elicitation") {
      this.emitError(frame.id, "NO_PENDING_ELICITATION", "当前没有待处理的提问。");
      return;
    }
    // 支持 `/elicitation <token> <v>` 与 `/elicitation <v>`。
    const parts = rest.split(/\s+/u);
    let value = rest;
    if (parts.length > 1 && parts[0] === pending.token) {
      value = parts.slice(1).join(" ");
    } else if (parts.length > 1 && pending.token) {
      this.emitError(frame.id, "BAD_TOKEN", "提问 token 不匹配。");
      return;
    }
    await this.applyElicitationAnswer(frame, binding, pending, value);
  }

  private async applyElicitationAnswer(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    pending: BotsPendingSelection,
    rawValue: string,
  ): Promise<void> {
    const value = rawValue.trim();
    if (SUBMIT_TOKENS.has(value.toLowerCase())) {
      await this.submitElicitation(frame, binding, pending);
      return;
    }
    const questions = pending.questions ?? [];
    const index = pending.currentQuestionIndex ?? 0;
    const question = questions[index];
    if (!question) {
      this.emitError(frame.id, "NO_PENDING_ELICITATION", "提问已失效。");
      return;
    }
    const option = this.resolveElicitationOption(question.options, value);
    if (!option) {
      this.emitError(frame.id, "BAD_OPTION", "无法识别选项。");
      return;
    }
    const answers = { ...pending.answers };
    const key = String(index);
    if (question.multiSelect) {
      const current = answers[key] ?? [];
      answers[key] = current.includes(option.value)
        ? current.filter((item) => item !== option.value)
        : [...current, option.value];
      binding.pending = { ...pending, answers };
      await this.persistBindings();
      // 多选：重发更新后的选项，不推进。
      const selection = buildElicitationSelection(
        this.elicitationDescriptor(pending),
        pending.token ?? "",
        pending.selectionId,
        answers,
      );
      this.appendDelivery(binding, this.openStream(binding), selection);
      return;
    }
    answers[key] = [option.value];
    if (index < questions.length - 1) {
      binding.pending = { ...pending, answers, currentQuestionIndex: index + 1 };
      await this.persistBindings();
      const selection = buildElicitationSelection(
        { ...this.elicitationDescriptor(pending), currentQuestionIndex: index + 1 },
        pending.token ?? "",
        pending.selectionId,
        answers,
      );
      this.appendDelivery(binding, this.openStream(binding), selection);
      return;
    }
    await this.submitElicitation(frame, binding, { ...pending, answers });
  }

  private async submitElicitation(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    pending: BotsPendingSelection,
  ): Promise<void> {
    const answers = pending.answers ?? {};
    const content: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      content[`answer_${key}`] = value;
    }
    await this.respondElicitationByBinding(binding, pending.requestId, "accept", content);
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
  }

  private async respondPermission(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    requestId: string,
    optionId: string,
  ): Promise<void> {
    await this.respondPermissionByBinding(binding, requestId, optionId);
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
  }

  private async respondPermissionByBinding(
    binding: BotsBinding,
    requestId: string,
    optionId: string,
  ): Promise<void> {
    const response = binding.pending?.responses?.[optionId];
    if (response === undefined) {
      throw new Error(`No stored permission response for option ${optionId}.`);
    }
    await this.options.runtime.respondPermission({
      binding,
      sessionId: binding.sessionId,
      ...(binding.runId ? { runId: binding.runId } : {}),
      requestId,
      optionId,
      response,
    });
    this.resumeAfterInteraction(binding);
  }

  private async respondElicitation(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): Promise<void> {
    await this.respondElicitationByBinding(binding, requestId, action, content);
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
  }

  private async respondElicitationByBinding(
    binding: BotsBinding,
    requestId: string,
    action: "accept" | "decline" | "cancel",
    content?: Record<string, unknown>,
  ): Promise<void> {
    await this.options.runtime.respondElicitation({
      binding,
      sessionId: binding.sessionId,
      ...(binding.runId ? { runId: binding.runId } : {}),
      requestId,
      action,
      ...(content ? { content } : {}),
    });
    this.resumeAfterInteraction(binding);
  }

  private async handleCancel(frame: BotsBridgeCommandFrame, binding: BotsBinding): Promise<void> {
    const pending = binding.pending;
    if (!pending) {
      this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
      await this.pushNotice(binding, "info", "没有待处理的交互。");
      return;
    }
    if (pending.kind === "elicitation") {
      await this.respondElicitationByBinding(binding, pending.requestId, "cancel");
      this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
      return;
    }
    const deny =
      pending.options.find((option) => option.label.includes("拒绝")) ?? pending.options.at(-1);
    if (!deny) {
      this.emitError(frame.id, "BAD_OPTION", "没有可用的拒绝选项。");
      return;
    }
    await this.respondPermissionByBinding(binding, pending.requestId, deny.id);
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
  }

  private async handleStop(frame: BotsBridgeCommandFrame, binding: BotsBinding): Promise<void> {
    await this.options.runtime.stopRun({
      binding,
      sessionId: binding.sessionId,
      ...(binding.runId ? { runId: binding.runId } : {}),
    });
    this.emitStatus(binding.bindingId, this.openStream(binding), "stopped", "已请求停止。");
  }

  private resumeAfterInteraction(binding: BotsBinding): void {
    binding.pending = undefined;
    binding.mode = "running";
    binding.updatedAt = this.clock();
    this.openStream(binding);
    void this.persistBindings();
  }

  // ── 轮次 ────────────────────────────────────────────────

  private async startTurn(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    text: string,
    options: { forceNew: boolean },
  ): Promise<void> {
    if (binding.mode === "running") {
      this.emitError(frame.id, "TASK_RUNNING", "上一条还在处理中。");
      return;
    }
    if (options.forceNew || !binding.sessionId) {
      const session = await this.options.runtime.createSession({
        binding,
        target: binding.target,
        forceNew: options.forceNew,
      });
      binding.sessionId = session.sessionId;
      binding.runId = undefined;
    }
    const streamId = this.openStream(binding);
    binding.mode = "running";
    binding.updatedAt = this.clock();
    await this.persistBindings();
    this.emitAccepted(frame.id, binding.bindingId, streamId);
    if (text.trim()) {
      const result = await this.options.runtime.sendPrompt({
        binding,
        sessionId: binding.sessionId,
        traceId: this.idFactory(),
        content: text,
      });
      if (result.runId) {
        binding.runId = result.runId;
      }
    }
  }

  private handleRuntimeEvent(event: ZCodeStreamEvent): void {
    const taskId = (event as { taskId?: string }).taskId;
    if (!taskId) {
      return;
    }
    const binding = [...this.bindings.values()].find((item) => item.sessionId === taskId);
    if (!binding) {
      return;
    }
    const streamId = this.activeStreams.get(binding.bindingId);
    if (!streamId) {
      // 没有活跃轮次时不投影，避免与已收口的流重复。
      return;
    }
    const projected = projectTaskStreamEvent(event);
    if (!projected) {
      return;
    }
    if (projected.interaction) {
      this.beginInteraction(binding, streamId, projected.interaction);
      return;
    }
    if (projected.payload) {
      this.appendDelivery(binding, streamId, projected.payload);
    }
    if (projected.terminal) {
      this.finishStream(binding, streamId, projected.terminal);
    }
  }

  private beginInteraction(
    binding: BotsBinding,
    streamId: string,
    descriptor: BotsInteractionDescriptor,
  ): void {
    const selectionId = `sel_${this.idFactory().replace(/-/gu, "").slice(0, 16)}`;
    if (descriptor.kind === "permission") {
      const payload = buildPermissionSelection(descriptor, selectionId);
      binding.pending = {
        kind: "permission",
        requestId: descriptor.requestId,
        selectionId,
        action: "permission.respond",
        title: descriptor.title,
        options: payload.options,
        responses: Object.fromEntries(
          descriptor.options.map((option) => [option.optionId, option.response]),
        ),
        taskId: binding.sessionId,
        ...(binding.runId ? { runId: binding.runId } : {}),
      };
      this.pauseWithSelection(binding, streamId, payload);
      return;
    }
    const token = `tok_${this.idFactory().replace(/-/gu, "").slice(0, 16)}`;
    const payload = buildElicitationSelection(descriptor, token, selectionId, {});
    binding.pending = {
      kind: "elicitation",
      requestId: descriptor.requestId,
      selectionId,
      token,
      action: "elicitation.respond",
      title: payload.title,
      options: payload.options,
      questions: descriptor.questions,
      currentQuestionIndex: descriptor.currentQuestionIndex,
      answers: {},
      taskId: binding.sessionId,
      ...(binding.runId ? { runId: binding.runId } : {}),
    };
    this.pauseWithSelection(binding, streamId, payload);
  }

  private pauseWithSelection(
    binding: BotsBinding,
    streamId: string,
    payload: BotsBridgeSelectionPayload,
  ): void {
    binding.mode = "awaiting_input";
    this.appendDelivery(binding, streamId, payload);
    this.activeStreams.delete(binding.bindingId);
    this.emitStatus(binding.bindingId, streamId, "awaiting_input");
    void this.persistBindings();
  }

  private finishStream(
    binding: BotsBinding,
    streamId: string,
    state: Exclude<BotsBridgeStreamState, "awaiting_input">,
  ): void {
    binding.mode = "idle";
    binding.runId = undefined;
    binding.updatedAt = this.clock();
    this.activeStreams.delete(binding.bindingId);
    this.emitStatus(binding.bindingId, streamId, state);
    void this.persistBindings();
  }

  private pendingSelectionPayload(pending: BotsPendingSelection): BotsBridgeSelectionPayload {
    if (pending.kind === "permission") {
      return {
        type: "selection",
        selectionId: pending.selectionId,
        title: pending.title,
        text: pending.title,
        options: pending.options,
        action: "permission.respond",
        requestId: pending.requestId,
        showCancel: false,
        meta: { kind: "permission" },
      };
    }
    return buildElicitationSelection(
      this.elicitationDescriptor(pending),
      pending.token ?? "",
      pending.selectionId,
      pending.answers ?? {},
    );
  }

  private elicitationDescriptor(pending: BotsPendingSelection): BotsElicitationDescriptor {
    return {
      kind: "elicitation",
      requestId: pending.requestId,
      questions: (pending.questions ?? []).map((question) => ({
        index: question.index,
        question: question.question,
        ...(question.header ? { header: question.header } : {}),
        ...(question.multiSelect ? { multiSelect: question.multiSelect } : {}),
        options: question.options.map((option) => ({
          value: option.value,
          label: option.label,
        })),
      })),
      currentQuestionIndex: pending.currentQuestionIndex ?? 0,
    };
  }

  // ── 选项解析 ────────────────────────────────────────────

  private resolveSelectionOption(
    pending: BotsPendingSelection,
    value: string,
  ): { id: string; label: string } | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index) && index >= 1 && index <= pending.options.length) {
      return pending.options[index - 1] ?? null;
    }
    return (
      pending.options.find((option) => option.id === trimmed || option.label === trimmed) ?? null
    );
  }

  private resolveElicitationOption(
    options: Array<{ value: string; label: string }>,
    value: string,
  ): { value: string; label: string } | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index) && index >= 1 && index <= options.length) {
      return options[index - 1] ?? null;
    }
    return options.find((option) => option.value === trimmed || option.label === trimmed) ?? null;
  }

  // ── 工具 ────────────────────────────────────────────────

  private async handleWorkspaceSet(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
    value: string,
  ): Promise<void> {
    if (binding.mode === "running") {
      this.emitError(frame.id, "TASK_RUNNING", "任务运行中，暂不能切换工作区。");
      return;
    }
    const target = await this.findWorkspace(value);
    if (!target) {
      this.emitError(frame.id, "WORKSPACE_NOT_FOUND", "找不到目标 workspace。");
      return;
    }
    const targetKey = workspaceKeyOf(target);
    if (
      !isWorkspaceAllowed(binding.allowedWorkspaces, targetKey) &&
      targetKey !== workspaceKeyOf(binding.target)
    ) {
      this.emitError(frame.id, "WORKSPACE_NOT_ALLOWED", "目标 workspace 不在允许范围内。");
      return;
    }
    binding.target = {
      workspacePath: target.workspacePath,
      ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
    };
    binding.sessionId = "";
    binding.runId = undefined;
    binding.updatedAt = this.clock();
    await this.persistBindings();
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
    await this.pushNotice(binding, "info", `已切换到 ${target.label}。`);
  }

  private async findWorkspace(value: string): Promise<BotsWorkspaceRef | null> {
    const trimmed = value.trim();
    const workspaces = await this.options.runtime.listWorkspaces();
    const index = Number.parseInt(trimmed, 10);
    if (Number.isFinite(index) && index >= 1 && index <= workspaces.length) {
      return workspaces[index - 1] ?? null;
    }
    return (
      workspaces.find(
        (workspace) =>
          workspace.id === trimmed ||
          workspace.workspacePath === trimmed ||
          workspaceKeyOf(workspace) === trimmed ||
          workspace.label === trimmed,
      ) ?? null
    );
  }

  private async sendWorkspaceList(
    frame: BotsBridgeCommandFrame,
    binding: BotsBinding,
  ): Promise<void> {
    const workspaces = (await this.options.runtime.listWorkspaces()).filter((workspace) =>
      isWorkspaceAllowed(binding.allowedWorkspaces, workspaceKeyOf(workspace)),
    );
    this.emitAccepted(frame.id, binding.bindingId, this.openStream(binding));
    const lines = workspaces.map((workspace, index) => `${index + 1}. ${workspace.label}`);
    await this.pushNotice(
      binding,
      "info",
      lines.length > 0 ? `可选工作区：\n${lines.join("\n")}` : "没有可用工作区。",
    );
  }

  private appendDelivery(
    binding: BotsBinding,
    streamId: string,
    payload: BotsBridgeDeliveryPayload,
  ): void {
    const frame = this.deliveryLog.append({
      bindingId: binding.bindingId,
      streamId,
      currentCursor: binding.deliveryCursor,
      payload,
    });
    binding.deliveryCursor = frame.seq;
    this.emit(frame);
  }

  private async pushNotice(
    binding: BotsBinding,
    level: "info" | "warn" | "error",
    message: string,
  ): Promise<void> {
    this.appendDelivery(binding, this.openStream(binding), {
      type: "notice",
      level,
      message,
    });
  }

  private openStream(binding: BotsBinding): string {
    const existing = this.activeStreams.get(binding.bindingId);
    if (existing) {
      return existing;
    }
    const streamId = `s_${this.idFactory().replace(/-/gu, "").slice(0, 16)}`;
    this.activeStreams.set(binding.bindingId, streamId);
    return streamId;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    const state = await this.options.repo.readBindings();
    for (const binding of state.bindings) {
      this.bindings.set(binding.bindingId, binding);
    }
    this.loaded = true;
  }

  private async persistBindings(): Promise<void> {
    await this.options.repo.writeBindings({
      ...createDefaultBotsBindings(),
      bindings: [...this.bindings.values()],
    });
  }

  private advanceCursor(bindingId: string, seq: number): void {
    const binding = this.bindings.get(bindingId);
    if (binding && seq > binding.deliveryCursor) {
      binding.deliveryCursor = seq;
      void this.persistBindings();
    }
  }

  private emitAccepted(inReplyTo: string, bindingId: string, streamId: string): void {
    this.emit({
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "accepted",
      id: this.idFactory(),
      inReplyTo,
      streamId,
      bindingId,
    });
  }

  private emitStatus(
    bindingId: string,
    streamId: string,
    state: BotsBridgeStreamState,
    message?: string,
  ): void {
    this.emit({
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "status",
      id: this.idFactory(),
      bindingId,
      streamId,
      state,
      ...(message ? { message } : {}),
    });
  }

  private emitError(inReplyTo: string, code: string, message: string): void {
    const frame: BotsBridgeErrorFrame = {
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "error",
      id: this.idFactory(),
      inReplyTo,
      code,
      message,
    };
    this.emit(frame);
  }

  private emit(frame: BotsBridgeServerFrame): void {
    for (const listener of this.frameListeners) {
      listener(frame);
    }
  }
}

const HELP_TEXT = [
  "命令：",
  "/new 新会话    /stop 停止    /status 状态",
  "/workspace [序号] 切换工作区    /unbind 解绑",
  "权限：/permission <序号> 或 /approve <requestId> <optionId>",
  "提问：/elicitation <token> <序号|submit>",
].join("\n");
