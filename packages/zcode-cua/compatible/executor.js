/**
 * 兼容层执行器：把 cua-driver 形状的输入类工具翻译到 mutter/WinRects 后端。
 *
 * 契约见 `.agents/specs/computer-use-wayland-input.md` §8.1（路由）与 §7（事件顺序）。
 *
 * 分工（§7.3）：
 *   - 元素框 / snapshot / 语义归 cua-driver（本文件通过注入的 `client` 现取）；
 *   - 窗口矩形 / 光标 / 注入归 helper（`backend`）；
 *   - 本文件不缓存任何状态。
 *
 * 观察类与语义类工具**不经过这里**，仍只走 cua-driver（见 `runtime.js` 路由）。
 */

import { isAscii } from "./evdev.js";
import { elementToScreen } from "./geometry.js";

/** 输入类工具：cua-driver 原生不可用时才可能路由到兼容层。 */
export const COMPAT_INPUT_TOOLS = new Set([
  "click",
  "double_click",
  "right_click",
  "drag",
  "scroll",
  "move_cursor",
  "hotkey",
  "press_key",
  "type_text",
  "mouse_button_down",
  "mouse_button_up",
  "mouse_drag",
]);

class CompatError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CompatError";
    this.code = code;
  }
}

function ok(text, level) {
  return {
    content: [{ type: "text", text }],
    isError: false,
    _meta: { compat: true, actionSent: true, ...(level ? { textLevel: level } : {}) },
  };
}

function fail(error) {
  const code = error instanceof CompatError ? error.code : "COMPAT_ERROR";
  return {
    content: [{ type: "text", text: error.message ?? String(error) }],
    isError: true,
    structuredContent: { code },
    _meta: { compat: true, actionSent: false, errorCode: code },
  };
}

/**
 * @param {object} options
 * @param {object} options.backend `createWaylandInputBackend` 的产物
 * @param {object} [options.client] cua-driver client（取元素框 / 语义 set_value）
 */
export function createCompatExecutor({ backend, client } = {}) {
  if (!backend || typeof backend.click !== "function") {
    throw new TypeError("compat executor requires a wayland input backend");
  }

  async function focus(args) {
    if (args.window_id === undefined || typeof backend.activate !== "function") return;
    await backend.activate(args.window_id);
  }

  async function resolvePoint(args) {
    const hasElement = args.element_token !== undefined || args.element_index !== undefined;
    if (!hasElement) {
      throw new CompatError(
        "compat backend needs element_index or element_token; raw pixel coordinates are not supported",
        "ACTION_UNAVAILABLE",
      );
    }
    if (!client || typeof client.callTool !== "function") {
      throw new CompatError("compat element resolution requires the cua-driver client", "ACTION_UNAVAILABLE");
    }
    const stateResult = await client.callTool(
      "get_window_state",
      JSON.stringify({ pid: args.pid, window_id: args.window_id }),
    );
    const state = JSON.parse(stateResult.structuredJson ?? "{}");
    const element = (state.elements ?? []).find((candidate) =>
      args.element_token !== undefined
        ? candidate.element_token === args.element_token
        : candidate.element_index === args.element_index,
    );
    if (!element?.frame) throw new CompatError("element not found in a fresh snapshot", "ACTION_UNAVAILABLE");

    const windows = await backend.listWindows();
    const window =
      windows.find((candidate) => candidate.id === args.window_id) ??
      windows.find((candidate) => candidate.pid === args.pid);
    if (!window) throw new CompatError("target window not found", "ACTION_UNAVAILABLE");
    const monitors = await backend.monitors();
    const scale = (monitors.find((monitor) => monitor.primary) ?? monitors[0])?.scale ?? 1;
    return elementToScreen({
      element: element.frame,
      window: { x: window.x, y: window.y },
      buffer: { x: window.buffer_x, y: window.buffer_y },
      scale,
    });
  }

  async function click(args, button) {
    const point = await resolvePoint(args);
    await focus(args);
    await backend.click(point.x, point.y, button);
    return ok(`compat ${button} click at ${point.x},${point.y}`);
  }

  async function hotkey(args) {
    const keys = Array.isArray(args.keys) ? args.keys : [];
    if (keys.length < 2) throw new CompatError("hotkey needs at least one modifier and one key", "ACTION_UNAVAILABLE");
    await focus(args);
    await backend.hotkey(keys.slice(0, -1), keys[keys.length - 1]);
    return ok(`compat hotkey ${keys.join("+")}`);
  }

  async function pressKey(args) {
    const modifiers = Array.isArray(args.modifiers) ? args.modifiers : [];
    await focus(args);
    if (modifiers.length > 0) await backend.hotkey(modifiers, args.key);
    else await backend.pressKey(args.key);
    return ok(`compat press ${[...modifiers, args.key].join("+")}`);
  }

  async function trySetValue(args, text) {
    if (!client || typeof client.callTool !== "function") return false;
    const hasElement = args.element_token !== undefined || args.element_index !== undefined;
    if (!hasElement) return false;
    try {
      const result = await client.callTool(
        "set_value",
        JSON.stringify({
          pid: args.pid,
          window_id: args.window_id,
          element_token: args.element_token,
          element_index: args.element_index,
          value: text,
        }),
      );
      return result?.isError !== true;
    } catch {
      return false;
    }
  }

  async function typeText(args) {
    const text = String(args.text ?? "");
    if (await trySetValue(args, text)) return ok("compat type_text via AT-SPI set_value", "set_value");
    await focus(args);
    if (isAscii(text)) {
      await backend.typeAscii(text);
      return ok("compat type_text via keycodes", "keycode");
    }
    await backend.typeUnicode(text);
    return ok("compat type_text via UTF-8 codepoints", "codepoint");
  }

  async function moveCursor(args) {
    if (Number.isFinite(args.x) && Number.isFinite(args.y)) {
      await backend.moveTo(args.x, args.y);
      return ok(`compat move_cursor to ${args.x},${args.y}`);
    }
    const point = await resolvePoint(args);
    await backend.moveTo(point.x, point.y);
    return ok(`compat move_cursor to ${point.x},${point.y}`);
  }

  async function execute({ toolName, arguments: args = {} }) {
    const tool = toolName;
    try {
      switch (tool) {
        case "click":
          return await click(args, args.button ?? "left");
        case "right_click":
          return await click(args, "right");
        case "double_click": {
          await click(args, args.button ?? "left");
          await click(args, args.button ?? "left");
          return ok("compat double click");
        }
        case "hotkey":
          return await hotkey(args);
        case "press_key":
          return await pressKey(args);
        case "type_text":
          return await typeText(args);
        case "move_cursor":
          return await moveCursor(args);
        default:
          return fail(
            new CompatError(`tool ${tool} is not supported by the legacy GNOME compat backend`, "ACTION_UNAVAILABLE"),
          );
      }
    } catch (error) {
      return fail(error);
    }
  }

  return {
    async execute(input) {
      return execute(input);
    },
    async dispose() {
      if (typeof backend.dispose === "function") await backend.dispose();
    },
  };
}

export { CompatError };