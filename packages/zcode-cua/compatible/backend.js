/**
 * 兼容层高层后端：把 evdev / geometry 纯函数与 helper 原语组合成 click / hotkey / typeText。
 *
 * 契约见 `.agents/specs/computer-use-wayland-input.md` §6、§7、§8.4。
 *
 * 状态所有权（§7.3）：窗口矩形、光标、截图归 WinRects 扩展；注入 session 归 helper 进程；
 * 元素框/AT-SPI 归 cua-driver。本后端**不缓存**这些状态，每次现取。
 */

import { hotkeySequence, isAscii, keySequence, mouseButtonCode, typedKeys } from "./evdev.js";
import { scaleAt, screenToRelativeMotion } from "./geometry.js";

const LEFT_SHIFT = 42;
const DEFAULT_KEY_HOLD_MS = 15;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 目标物理点所在 logical monitor 的 scale（变 scale，§5.6）。
 * monitors 来自 helper 的 `monitors`（逻辑坐标 + scale），先换算成物理边界再命中。
 */
function scaleForPoint(monitors, point, fallback) {
  const physical = (Array.isArray(monitors) ? monitors : []).map((monitor) => ({
    x: monitor.x * monitor.scale,
    y: monitor.y * monitor.scale,
    w: monitor.w * monitor.scale,
    h: monitor.h * monitor.scale,
    scale: monitor.scale,
  }));
  const primary = (monitors ?? []).find((monitor) => monitor.primary);
  return scaleAt(physical, point, primary?.scale ?? fallback);
}

/**
 * @param {object} options
 * @param {{ request: Function }} options.helper helper 客户端端口
 * @param {Function} [options.sleep] 注入的延时（测试用）
 * @param {number} [options.keyHoldMs] 逐键间隔
 */
export function createWaylandInputBackend({ helper, sleep = defaultSleep, keyHoldMs = DEFAULT_KEY_HOLD_MS } = {}) {
  if (!helper || typeof helper.request !== "function") {
    throw new TypeError("compat backend requires a helper port with request()");
  }

  async function runSequence(sequence) {
    for (const step of sequence) {
      await helper.request("keycode", { code: step.code, pressed: step.state === "down" });
      await sleep(keyHoldMs);
    }
  }

  async function resolveScale(point) {
    const monitors = await helper.request("monitors");
    const primary = monitors.find((monitor) => monitor.primary);
    return scaleForPoint(monitors, point, primary?.scale ?? 1);
  }

  async function moveTo(x, y) {
    const [cursor, monitors] = await Promise.all([
      helper.request("getCursor"),
      helper.request("monitors"),
    ]);
    const primary = monitors.find((monitor) => monitor.primary);
    const scale = scaleForPoint(monitors, { x, y }, primary?.scale ?? 1);
    const { dx, dy } = screenToRelativeMotion({ x, y }, cursor, scale);
    await helper.request("moveRel", { dx, dy });
    return { x, y, scale };
  }

  async function click(x, y, button = "left") {
    const code = mouseButtonCode(button);
    if (code === undefined) throw new Error(`unknown mouse button: ${button}`);
    await moveTo(x, y);
    await helper.request("button", { code, pressed: true });
    await helper.request("button", { code, pressed: false });
  }

  async function button(code, pressed) {
    await helper.request("button", { code, pressed: pressed === true });
  }

  async function keycode(code, pressed) {
    await helper.request("keycode", { code, pressed: pressed === true });
  }

  async function pressKey(key) {
    const sequence = keySequence(key);
    if (!sequence) throw new Error(`unknown key: ${key}`);
    await runSequence(sequence);
  }

  async function hotkey(modifiers, key) {
    await runSequence(hotkeySequence(modifiers, key));
  }

  async function typeAscii(text) {
    const keys = typedKeys(text);
    if (!keys) throw new Error("typeAscii only accepts ASCII text");
    for (const { code, shift } of keys) {
      if (shift) {
        await keycode(LEFT_SHIFT, true);
        await sleep(keyHoldMs);
      }
      await keycode(code, true);
      await keycode(code, false);
      if (shift) await keycode(LEFT_SHIFT, false);
      await sleep(keyHoldMs);
    }
  }

  /**
   * type_text 分级（§6.4）：AT-SPI set_value → ASCII keycode → 剪贴板。
   * `trySetValue` / `pasteText` 由上层注入（分别走 cua-driver 与剪贴板端口）。
   */
  async function typeText(text, { trySetValue, pasteText } = {}) {
    if (typeof trySetValue === "function" && (await trySetValue(text)) === true) {
      return { level: "set_value" };
    }
    if (isAscii(text)) {
      await typeAscii(text);
      return { level: "keycode" };
    }
    if (typeof pasteText === "function") {
      await pasteText(text);
      return { level: "clipboard" };
    }
    throw new Error("non-ASCII text needs a clipboard fallback or an editable AT-SPI element");
  }

  return {
    listWindows: () => helper.request("listWindows"),
    capture: () => helper.request("capture"),
    getCursor: () => helper.request("getCursor"),
    monitors: () => helper.request("monitors"),
    activate: (windowId) => helper.request("activate", { id: windowId }),
    scaleFor: resolveScale,
    moveTo,
    button,
    keycode,
    click,
    pressKey,
    hotkey,
    typeAscii,
    typeText,
    dispose: () => (typeof helper.dispose === "function" ? helper.dispose() : undefined),
  };
}