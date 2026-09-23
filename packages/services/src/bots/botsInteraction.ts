// 交互载荷构建：对齐官方 ZCode 的 `selection` 抽象。见 .agents/specs/bots-astrbot-bridge.md。
//
// canonical 文本格式照抄官方 buildSelectionText（host.pretty.js @16157）：
//   每行 “序号. 标签”，下一行是该选项要发送的命令。
// 纯文本平台（AstrBot/飞书、QQ）直接打印 canonical 文本；结构化字段留给程序化客户端。

import type { BotsBridgeSelectionOption, BotsBridgeSelectionPayload } from "@zcode/shared";

export interface BotsPermissionDescriptor {
  kind: "permission";
  requestId: string;
  title: string;
  description?: string;
  options: Array<{
    optionId: string;
    label: string;
    description?: string;
    kind: string;
    /** 运行时权限应答体（ZCodePermissionResponse），不上 wire，只进 pending。 */
    response: unknown;
  }>;
}

export interface BotsElicitationQuestionDescriptor {
  index: number;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ value: string; label: string; description?: string }>;
}

export interface BotsElicitationDescriptor {
  kind: "elicitation";
  requestId: string;
  questions: BotsElicitationQuestionDescriptor[];
  currentQuestionIndex: number;
  planApproval?: string;
}

export type BotsInteractionDescriptor = BotsPermissionDescriptor | BotsElicitationDescriptor;

/** 选项对应的用户可见命令；对齐官方 formatSelectionCommand。 */
export function formatSelectionCommand(params: {
  action: string;
  token?: string;
  value: string;
}): string {
  if (params.action === "permission.respond") {
    return `/permission ${params.value}`;
  }
  if (params.action === "elicitation.respond") {
    return params.token
      ? `/elicitation ${params.token} ${params.value}`
      : `/elicitation ${params.value}`;
  }
  return `/${params.action.replace(/\.set$/u, "")} ${params.value}`;
}

/** canonical 文本：标题 + 每个选项“序号. 标签”+“对应命令”。 */
export function buildSelectionText(params: {
  title: string;
  description?: string;
  options: BotsBridgeSelectionOption[];
  action: string;
  token?: string;
}): string {
  const lines = params.options.map((option, index) => {
    const suffix = option.description ? ` - ${option.description}` : "";
    const command = formatSelectionCommand({
      action: params.action,
      ...(params.token ? { token: params.token } : {}),
      value: String(index + 1),
    });
    return `${index + 1}. ${option.label}${suffix}\n${command}`;
  });
  return [params.title, params.description ?? "", ...lines]
    .filter((part) => part.length > 0)
    .join("\n");
}

export function buildPermissionSelection(
  descriptor: BotsPermissionDescriptor,
  selectionId: string,
): BotsBridgeSelectionPayload {
  const options: BotsBridgeSelectionOption[] = descriptor.options.map((option) => ({
    id: option.optionId,
    label: option.label,
    ...(option.description ? { description: option.description } : {}),
  }));
  const title = descriptor.title || "需要权限";
  return {
    type: "selection",
    selectionId,
    title,
    text: buildSelectionText({
      title,
      ...(descriptor.description ? { description: descriptor.description } : {}),
      options,
      action: "permission.respond",
    }),
    options,
    action: "permission.respond",
    requestId: descriptor.requestId,
    showCancel: false,
    meta: { kind: "permission" },
  };
}

export function buildElicitationSelection(
  descriptor: BotsElicitationDescriptor,
  token: string,
  selectionId: string,
  answers: Record<string, string[]>,
): BotsBridgeSelectionPayload {
  const question = descriptor.questions[descriptor.currentQuestionIndex] ?? descriptor.questions[0];
  const selected = new Set(answers[String(descriptor.currentQuestionIndex)] ?? []);
  const options: BotsBridgeSelectionOption[] =
    question?.options.map((option) => ({
      id: option.value,
      label: question.multiSelect
        ? `${selected.has(option.value) ? "[x]" : "[ ]"} ${option.label}`
        : option.label,
      ...(option.description ? { description: option.description } : {}),
    })) ?? [];
  if (question?.multiSelect) {
    options.push({ id: "__submit__", label: "提交" });
  }
  const headerParts = [
    descriptor.questions.length > 1
      ? `${descriptor.currentQuestionIndex + 1}/${descriptor.questions.length}`
      : "",
    question?.header && question.header !== question.question ? question.header : "",
    question?.question ?? "",
    question?.multiSelect ? "可多选，回复 /elicitation <token> submit 提交" : "",
  ].filter((part) => part.length > 0);
  const title = headerParts.join("\n");
  return {
    type: "selection",
    selectionId,
    title,
    text: buildSelectionText({ title, options, action: "elicitation.respond", token }),
    options,
    action: "elicitation.respond",
    requestId: descriptor.requestId,
    token,
    showCancel: true,
    cancelLabel: "取消",
    meta: {
      kind: "elicitation",
      currentQuestionIndex: descriptor.currentQuestionIndex,
      total: descriptor.questions.length,
      ...(question?.multiSelect ? { multiSelect: true } : {}),
      status: "pending",
      ...(descriptor.planApproval ? { planApproval: descriptor.planApproval } : {}),
    },
  };
}
