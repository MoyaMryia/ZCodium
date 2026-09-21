/**
 * node:sqlite 的加载。
 *
 * 单独成模块有两个原因：
 *   1. 恢复与扫描都要用，而 `node:sqlite` 在部分 Node 版本上仍标 experimental，
 *      加载时的那行告警必须屏蔽——它混在给人看的输出里只会造成误解。
 *   2. 屏蔽窗口必须只包住 import。全程替换 process.emitWarning 会连真告警一起吞掉。
 *
 * 加载失败（Node 过旧、编译时未启用）时不在这里抛：由调用方决定是报错还是降级。
 */

let DatabaseSync = null;
let loadError = null;

try {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function filterSqliteExperimentalWarning(warning, ...rest) {
    if (String(warning).includes("SQLite is an experimental feature")) return;
    return originalEmitWarning.call(process, warning, ...rest);
  };
  const loaded = await import("node:sqlite");
  process.emitWarning = originalEmitWarning;
  DatabaseSync = loaded.DatabaseSync;
} catch (error) {
  loadError = error;
}

/** 读方式打开。库不存在、为空、或不被 sqlite 识别时返回 null。 */
export function openReadOnly(path) {
  if (!DatabaseSync) return null;
  try {
    return new DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

/** 写方式打开。拿不到 sqlite 时抛，因为恢复无法降级。 */
export function openWritable(path) {
  if (!DatabaseSync) {
    throw new Error(
      `node:sqlite is unavailable${loadError ? `: ${String(loadError)}` : ""}`,
    );
  }
  return new DatabaseSync(path);
}

export function isSqliteAvailable() {
  return DatabaseSync !== null;
}
