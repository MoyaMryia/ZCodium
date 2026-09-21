/**
 * 旧会话恢复共用的取值助手。
 *
 * 单独成模块是因为恢复与扫描两个入口都要用：一套语义两处各写一遍，迟早会出现
 * 「扫描认为恢复了、恢复脚本认为没有」这种对不上的情况。
 */

/** 非空字符串，否则 undefined。 */
export function asText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/** 有限数字，否则 undefined。`NaN`/`Infinity` 会被拒绝。 */
export function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 丢掉值为 undefined 的键，让 JSON.stringify 不产出 `"key": undefined` 之外的噪声。 */
export function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

/** 只接受「看起来是对象」的值；数组与 null 都当空对象。 */
export function asObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * 序列化成可入库的文本。
 *
 * 字符串原样保留（旧快照里 `raw` 经常已经是 JSON 字符串），其余 JSON 化。
 * undefined/null 归一成空串，避免列里出现字面量 "null"。
 */
export function asStoredText(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 压成单行摘要，超长截断。用于从正文反推标题。 */
export function summarizeText(value, maxLength = 80) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}
