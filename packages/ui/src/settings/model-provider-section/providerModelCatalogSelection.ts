/** 模型目录弹窗的候选行：已添加的模型只读，未添加的可勾选。 */
export interface ProviderModelCatalogItem {
  readonly modelId: string;
  readonly alreadyAdded: boolean;
}

/**
 * 把拉取到的 modelId 与当前 Provider 已有模型对齐。
 * 同一 provider 下 modelId 唯一，因此按 ID 去重；保持拉取顺序，已添加的排在后备展示里也不重复出现。
 */
export function resolveModelCatalogItems(
  modelIds: readonly string[],
  existingModelIds: readonly string[],
): ProviderModelCatalogItem[] {
  const existing = new Set(existingModelIds);
  const seen = new Set<string>();
  const items: ProviderModelCatalogItem[] = [];
  for (const modelId of modelIds) {
    const trimmed = modelId.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    items.push({ modelId: trimmed, alreadyAdded: existing.has(trimmed) });
  }
  return items;
}

/** 默认勾选策略：只预勾未添加项，已添加项不可再选。 */
export function resolveDefaultCatalogSelection(
  items: readonly ProviderModelCatalogItem[],
): string[] {
  return items.filter((item) => !item.alreadyAdded).map((item) => item.modelId);
}

/** 添加结果摘要：全部成功 / 部分失败 / 全部失败。 */
export function summarizeCatalogAddResults(results: readonly boolean[]): {
  added: number;
  failed: number;
} {
  return {
    added: results.filter((result) => result).length,
    failed: results.filter((result) => !result).length,
  };
}
