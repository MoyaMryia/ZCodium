import type {
  BotConfig,
  BotProvider,
  BotReplyGranularity,
} from "@zcode/shared";
import { getSupportedBotReplyGranularities } from "@zcode/shared";

export type BotProviderEntryId = BotProvider | "dingding";

type BotProviderEntry =
  | { id: BotProvider; label: string; implemented: true }
  | { id: BotProviderEntryId; label: string; implemented: false };

export const BOT_PROVIDERS: BotProviderEntry[] = [
  // 当前只启用 AstrBot 桥接；官方平台适配器代码保留，待后续与桥接统一后再开放。
  { id: "astrbot", label: "AstrBot", implemented: true },
  { id: "weixin", label: "Weixin", implemented: false },
  { id: "feishu", label: "Feishu", implemented: false },
  { id: "lark", label: "Lark", implemented: false },
  { id: "telegram", label: "Telegram", implemented: false },
  { id: "dingding", label: "DingTalk", implemented: false },
  { id: "discord", label: "Discord", implemented: false },
  { id: "wecom", label: "WeCom", implemented: false },
  { id: "webhook", label: "Webhook", implemented: false },
];

export const BOT_REPLY_GRANULARITIES: Array<{
  id: BotReplyGranularity;
  labelId: string;
  descriptionId: string;
}> = [
  {
    id: "assistant_changes",
    labelId: "bots.replyGranularity.assistantChanges",
    descriptionId: "bots.replyGranularity.assistantChanges.description",
  },
  {
    id: "assistant_toolcalls_changes",
    labelId: "bots.replyGranularity.assistantToolcallsChanges",
    descriptionId: "bots.replyGranularity.assistantToolcallsChanges.description",
  },
  {
    id: "summary_changes",
    labelId: "bots.replyGranularity.summaryChanges",
    descriptionId: "bots.replyGranularity.summaryChanges.description",
  },
  {
    id: "streaming_card",
    labelId: "bots.replyGranularity.streamingCard",
    descriptionId: "bots.replyGranularity.streamingCard.description",
  },
];

export const DEFAULT_BOT_REPLY_GRANULARITY_ENTRY = BOT_REPLY_GRANULARITIES[0]!;

export function getBotReplyGranularitiesForProvider(
  provider: BotProvider,
): typeof BOT_REPLY_GRANULARITIES {
  const supportedIds = new Set(getSupportedBotReplyGranularities(provider));
  return BOT_REPLY_GRANULARITIES.filter((granularity) =>
    supportedIds.has(granularity.id),
  );
}

export function getBotReplyGranularityEntryForProvider(
  provider: BotProvider,
  replyMode: BotReplyGranularity,
) {
  const granularities = getBotReplyGranularitiesForProvider(provider);
  return (
    granularities.find((granularity) => granularity.id === replyMode) ??
    granularities[0] ??
    DEFAULT_BOT_REPLY_GRANULARITY_ENTRY
  );
}

export function getBotProviderRegionTagLabelId(
  provider: BotProviderEntryId,
): string | null {
  switch (provider) {
    case "lark":
      return "login.oauth.regionTag.zai";
    case "feishu":
      return "login.oauth.regionTag.bigmodel";
    default:
      return null;
  }
}

export function buildCurrentWorkspaceId(
  workspacePath: string,
  workspaceIdentity?: string,
): string {
  return workspaceIdentity?.trim() || workspacePath;
}

type BotProviderEntryResolution =
  | { mode: "select"; botId: string }
  | { mode: "create"; provider: BotProvider };

export function resolveBotProviderEntry(
  bots: BotConfig[],
  provider: BotProvider,
): BotProviderEntryResolution {
  const existingBot = bots.find((bot) => bot.provider === provider);
  if (existingBot) {
    return { mode: "select", botId: existingBot.id };
  }

  return { mode: "create", provider };
}
