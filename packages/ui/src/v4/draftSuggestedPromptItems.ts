import type { ClientSceneConfig, ClientSceneItem } from "@zcode/services";

export interface DraftSuggestedPromptLocalizedText {
  cn?: string;
  en?: string;
}

export const DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS = "NAVIGATE:AUTOMATIONS" as const;
export type DraftSuggestedPromptAction = typeof DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS;

export interface DraftSuggestedPromptItem {
  id: string;
  /** Lucide canonical 名称，来自本地推荐或 ClientSceneItem.img；不使用 imgs。 */
  iconName?: string;
  /** 推荐项的随包图片资源。 */
  iconUrl?: string;
  /** 复用插件市场图标的展示样式，不代表绑定插件。 */
  iconStyle?: "plugin";
  label: DraftSuggestedPromptLocalizedText;
  prompt: DraftSuggestedPromptLocalizedText;
  actions?: DraftSuggestedPromptAction[];
  plugin?: {
    stableId: string;
    label: DraftSuggestedPromptLocalizedText;
  };
}

function parseDraftSuggestedPromptActions(
  onFinish: string | null | undefined,
): DraftSuggestedPromptAction[] {
  if (!onFinish) return [];

  const actions: DraftSuggestedPromptAction[] = [];
  for (const token of onFinish.split(",")) {
    switch (token.trim()) {
      case DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS:
        if (!actions.includes(DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS)) {
          actions.push(DRAFT_SUGGESTED_PROMPT_NAVIGATE_AUTOMATIONS);
        }
        break;
      default:
        break;
    }
  }
  return actions;
}

function findDefaultItem(
  scene: ClientSceneConfig,
  promptItem: ClientSceneItem,
): ClientSceneItem | undefined {
  for (const [optionKey, itemIds] of Object.entries(promptItem.defaults ?? {})) {
    const optionItems = scene.options[optionKey]?.items;
    if (!optionItems) continue;
    for (const itemId of itemIds) {
      const item = optionItems.find((candidate) => candidate.id === itemId);
      if (item) return item;
    }
  }
  return undefined;
}

export function mapClientScenesToDraftSuggestedPromptItems(
  scenes: readonly ClientSceneConfig[],
): DraftSuggestedPromptItem[] {
  const scene = scenes.find((candidate) => candidate.scene === "draft-suggestion");
  const promptItems = scene?.options.prompts?.items;
  if (!scene || !promptItems) return [];

  // 旧闲时推荐不能退化成普通 prompt，避免把原本免费的官方排队任务发给自配模型。
  return promptItems
    .filter(
      (item) =>
        !item.on_finish
          ?.split(",")
          .some((action) => action.trim() === "NAVIGATE:AUTOMATIONS:OFFPEAK"),
    )
    .map((item) => {
      const defaultItem = findDefaultItem(scene, item);
      const actions = parseDraftSuggestedPromptActions(item.on_finish);
      const stableId = defaultItem?.contents.en?.trim() || defaultItem?.contents.cn?.trim();
      return {
        id: item.id,
        ...(item.img?.trim() ? { iconName: item.img.trim() } : {}),
        label: item.labels,
        prompt: item.contents,
        ...(actions.length > 0 ? { actions } : {}),
        ...(defaultItem && stableId
          ? {
              plugin: {
                stableId,
                label: defaultItem.labels,
              },
            }
          : {}),
      };
    });
}

export function resolveDraftSuggestedPromptText(
  text: DraftSuggestedPromptLocalizedText,
  locale: string,
): string {
  const primary = locale.startsWith("zh") ? text.cn : text.en;
  const fallback = locale.startsWith("zh") ? text.en : text.cn;
  return primary?.trim() || fallback?.trim() || "";
}
