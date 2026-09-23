/**
 * ZCode 模型面（14 工具）↔ cua-driver 的映射层。
 *
 * 契约见 `.agents/specs/computer-use-capabilities.md` §2、§3。
 *
 * 职责：
 *   - 把 ZCode 工具名/参数翻译到 cua-driver 工具名/参数（或兼容层）；
 *   - 维护**唯一的观测缓存** `(pid, window) → { stateId, elements }`，把 `target:number`
 *     解析到该快照的 `element_token`（无观测 → STALE_STATE）；
 *   - 把结果投影回 ZCode 形状（`state_id`/`elements`/`app`/`window`/`action_sent`）。
 *
 * 不做：`select_text`、通用 `perform_action`、富文本 paste、多光标（§4）。
 */

import { COMPAT_INPUT_TOOLS } from "./compatible/executor.js";

/** ZCode 模型面的 14 个工具名（冻结）。 */
export const ZCODE_SURFACE_TOOLS = Object.freeze([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "left_click_drag",
  "scroll",
  "type",
  "set_value",
  "select_text",
  "key",
  "paste",
  "perform_action",
  "request_access",
  "stop_computer_control",
]);

function parseJson(text, fallback) {
  if (typeof text !== "string" || text.length === 0) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function structured(raw) {
  return parseJson(raw?.structuredJson, undefined);
}

/** 支持 `delivery_mode` 的输入类工具：后台拿不到就前台重试。 */
const FOREGROUND_FALLBACK_TOOLS = new Set([
  "click",
  "double_click",
  "right_click",
  "drag",
  "scroll",
  "type_text",
  "press_key",
  "hotkey",
  "mouse_button_down",
  "mouse_button_up",
  "mouse_drag",
]);

function isBackgroundUnavailable(value) {
  const code = value?.errorCode ?? value?.code;
  if (code === "background_unavailable") return true;
  return /background[_ ]?unavailable/i.test(String(value?.message ?? value?.text ?? ""));
}

function markForeground(result, fallback) {
  const meta = { ...result?._meta, deliveryMode: "foreground" };
  if (fallback) meta.foregroundFallback = true;
  return { ...result, _meta: meta };
}

/** `ctrl+shift+t` → `{ modifiers:["ctrl","shift"], key:"t" }`。 */
export function parseKeyChord(text) {
  const parts = String(text ?? "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return { modifiers: [], key: parts[0] ?? String(text ?? "") };
  return { modifiers: parts.slice(0, -1), key: parts[parts.length - 1] };
}

function pointsFromTarget(target) {
  if (Array.isArray(target) && target.length === 2) return { x: target[0], y: target[1] };
  return undefined;
}

/**
 * @param {object} options
 * @param {Function} options.callDriver `(toolName, args, signal) => Promise<ToolResult>`
 * @param {object} [options.compat] 兼容层执行器（老 GNOME）
 * @param {boolean} [options.compatApplies]
 * @param {Function} options.projectDriverResult raw ToolResult → CallToolResult
 * @param {Function} options.projectDriverError
 */
export function createSurfaceLayer({
  callDriver,
  compat,
  compatApplies = Boolean(compat?.applies),
  projectDriverResult,
  projectDriverError,
}) {
  const observations = new Map();
  const appCache = new Map();

  const keyFor = (pid, windowId) => `${pid ?? "?"}:${windowId ?? "?"}`;

  function remember(pid, windowId, stateId, elements) {
    const entry = { stateId, elements, byIndex: new Map() };
    for (const element of elements) {
      if (typeof element.element_index === "number") entry.byIndex.set(element.element_index, element);
    }
    observations.set(keyFor(pid, windowId), entry);
    observations.set(keyFor(pid, undefined), entry);
  }

  function lookupElement(pid, windowId, index) {
    const entry = observations.get(keyFor(pid, windowId)) ?? observations.get(keyFor(pid, undefined));
    return entry?.byIndex.get(index);
  }

  function stale() {
    const error = new Error("element index has no observation behind it; call get_app_state first");
    error.code = "STALE_STATE";
    return error;
  }

  async function resolvePid(appRef, signal) {
    if (appRef === undefined || appRef === null) return undefined;
    let ref = appRef;
    if (typeof ref === "string") ref = { bundle_id: ref };
    if (typeof ref.pid === "number") return ref.pid;
    const wanted = ref.name ?? ref.bundle_id;
    if (wanted !== undefined && appCache.has(wanted)) return appCache.get(wanted);
    const raw = await callDriver("list_apps", {}, signal);
    const list = structured(raw)?.apps ?? [];
    const wantedName = ref.name;
    const wantedBundle = ref.bundle_id;
    const byName = (app, want) =>
      app.name === want ||
      app.appName === want ||
      String(app.name ?? "").toLowerCase() === String(want).toLowerCase() ||
      String(app.name ?? "").toLowerCase().includes(String(want).toLowerCase());
    const found = list.find(
      (app) =>
        (wantedName !== undefined && byName(app, wantedName)) ||
        (wantedBundle !== undefined &&
          (app.bundleId === wantedBundle || app.bundle_id === wantedBundle || app.identifier === wantedBundle)),
    );
    if (!found) {
      const error = new Error(`app not found: ${wanted}`);
      error.code = "INVALID_APP";
      throw error;
    }
    if (wanted !== undefined && typeof found.pid === "number") appCache.set(wanted, found.pid);
    return found.pid;
  }

  async function resolveScope(input, args) {
    const pid = await resolvePid(args.app_ref, input.signal);
    let windowId = args.window_id ?? args.app_ref?.window_id;
    if (windowId === undefined && pid !== undefined) {
      const raw = await callDriver("list_windows", { pid }, input.signal);
      const data = structured(raw);
      const windows = Array.isArray(data) ? data : (data?.windows ?? []);
      const target = windows.find((window) => window.is_on_screen !== false && window.z_index !== null) ?? windows[0];
      windowId = target?.window_id ?? target?.id;
    }
    return { pid, windowId };
  }

  async function forwardToDriver(driverTool, args, input) {
    const canFallback = FOREGROUND_FALLBACK_TOOLS.has(driverTool) && args.delivery_mode !== "foreground";
    try {
      const raw = await callDriver(driverTool, args, input.signal);
      if (canFallback && raw?.isError && isBackgroundUnavailable(raw)) {
        const retry = await callDriver(driverTool, { ...args, delivery_mode: "foreground" }, input.signal);
        return markForeground(projectDriverResult(retry), true);
      }
      return projectDriverResult(raw);
    } catch (error) {
      if (canFallback && isBackgroundUnavailable(error)) {
        const retry = await callDriver(driverTool, { ...args, delivery_mode: "foreground" }, input.signal);
        return markForeground(projectDriverResult(retry), true);
      }
      throw error;
    }
  }

  async function dispatch(driverTool, driverArgs, input) {
    if (compatApplies && COMPAT_INPUT_TOOLS.has(driverTool) && compat) {
      // 兼容层会自己重新观测，旧 element_token 必然过期 → 传 index。
      const args = { ...driverArgs };
      delete args.element_token;
      const result = await compat.execute({ toolName: driverTool, arguments: args, context: input.context, signal: input.signal });
      // 兼容层是 mutter 全局注入，只能前台（决策 1）。
      return { compat: true, result: markForeground(result, false) };
    }
    // cua-driver 用 per-snapshot token；index 可能与合成快照不匹配。
    const args = { ...driverArgs };
    delete args.element_index;
    return { compat: false, result: await forwardToDriver(driverTool, args, input) };
  }

  async function targetArgs(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const point = pointsFromTarget(args.target);
    if (point) return { pid, window_id: windowId, x: point.x, y: point.y };
    if (typeof args.target !== "number") {
      const error = new Error("target must be an element index or [x, y]");
      error.code = "INTERNAL";
      throw error;
    }
    const element = lookupElement(pid, windowId, args.target);
    if (!element) throw stale();
    return { pid, window_id: windowId, element_index: args.target, element_token: element.element_token };
  }

  async function getAppState(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const raw = await callDriver(
      "get_window_state",
      withoutUndefined({ pid, window_id: windowId, include_screenshot: args.include_screenshot === true, include_accessibility_tree: true }),
      input.signal,
    );
    const structured = parseJson(raw?.structuredJson, {}) ?? {};
    const elements = Array.isArray(structured.elements) ? structured.elements : [];
    const stateId = structured.snapshot_id ?? structured.state_id ?? `s-${Date.now()}`;
    remember(pid, windowId, stateId, elements);
    const content = [];
    if (typeof raw?.text === "string" && raw.text.length > 0) content.push({ type: "text", text: raw.text });
    for (const image of Array.isArray(raw?.images) ? raw.images : []) {
      if (image?.dataBase64) content.push({ type: "image", data: image.dataBase64, mimeType: image.mimeType });
    }
    return {
      content,
      isError: false,
      structuredContent: {
        state_id: stateId,
        frame_id: structured.frame_id ?? stateId,
        elements,
        app: { pid, name: structured.app_name ?? structured.appName, bundle_id: structured.bundle_id },
        window: {
          window_id: structured.window_id ?? windowId,
          title: structured.window_title ?? structured.title,
          bounds: structured.window_bounds ?? structured.bounds,
        },
      },
      // 决策 2：先信未确认身份的截图。
      _meta: { screenshotUnverified: true },
    };
  }

  async function clickTool(input, args, button) {
    const base = await targetArgs(input, args);
    const driverArgs = withoutUndefined({
      ...base,
      button: button ?? args.mouse_button ?? "left",
      count: args.click_count,
      modifier: args.modifiers,
    });
    const { result } = await dispatch("click", driverArgs, input);
    return result;
  }

  async function dragTool(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const from = pointsFromTarget(args.from_target);
    const to = pointsFromTarget(args.to);
    const fromArgs = from
      ? { from_x: from.x, from_y: from.y }
      : { from_element_token: args.from_target !== undefined ? lookupElement(pid, windowId, args.from_target)?.element_token : undefined };
    const toArgs = to
      ? { to_x: to.x, to_y: to.y }
      : { to_element_token: args.to !== undefined ? lookupElement(pid, windowId, args.to)?.element_token : undefined };
    const driverArgs = withoutUndefined({ pid, window_id: windowId, ...fromArgs, ...toArgs, button: args.mouse_button ?? "left", modifier: args.modifiers });
    const { result } = await dispatch("drag", driverArgs, input);
    return result;
  }

  async function scrollTool(input, args) {
    const base = await targetArgs(input, args);
    const driverArgs = withoutUndefined({ ...base, direction: args.scroll_direction, amount: args.scroll_amount ?? 1 });
    const { result } = await dispatch("scroll", driverArgs, input);
    return result;
  }

  async function typeTool(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const elementIndex = typeof args.target === "number" ? args.target : undefined;
    const elementToken = elementIndex !== undefined ? lookupElement(pid, windowId, elementIndex)?.element_token : undefined;
    const driverArgs = withoutUndefined({ pid, window_id: windowId, element_index: elementIndex, element_token: elementToken, text: args.text });
    const { result } = await dispatch("type_text", driverArgs, input);
    return result;
  }

  async function keyTool(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const { modifiers, key } = parseKeyChord(args.text);
    const driverTool = modifiers.length > 0 ? "hotkey" : "press_key";
    const driverArgs = modifiers.length > 0 ? withoutUndefined({ pid, window_id: windowId, keys: [...modifiers, key] }) : withoutUndefined({ pid, window_id: windowId, key });
    const repeat = Number.isFinite(args.repeat) && args.repeat > 1 ? Math.trunc(args.repeat) : 1;
    let result;
    for (let index = 0; index < repeat; index += 1) {
      ({ result } = await dispatch(driverTool, driverArgs, input));
    }
    return result;
  }

  async function pasteTool(input, args) {
    const text = String(args.text ?? "");
    const write = await dispatch("clipboard_write", { text }, input);
    if (write.result?.isError) return write.result;
    const { result } = await dispatch("hotkey", { keys: ["ctrl", "v"] }, input);
    return result;
  }

  async function setValueTool(input, args) {
    const { pid, windowId } = await resolveScope(input, args);
    const element = typeof args.target === "number" ? lookupElement(pid, windowId, args.target) : undefined;
    if (!element) throw stale();
    const { result } = await dispatch("set_value", withoutUndefined({ pid, window_id: windowId, element_index: args.target, element_token: element.element_token, value: args.value }), input);
    return result;
  }

  function unavailable(tool) {
    return {
      content: [{ type: "text", text: `${tool} is not supported: cua-driver has no equivalent primitive` }],
      isError: true,
      structuredContent: { code: "ACTION_UNAVAILABLE" },
      _meta: { actionSent: false, errorCode: "ACTION_UNAVAILABLE" },
    };
  }

  async function execute(input) {
    const { toolName } = input;
    const args = input.arguments ?? {};
    try {
      switch (toolName) {
        case "list_apps": {
          const raw = await callDriver("list_apps", {}, input.signal);
          const apps = structured(raw)?.apps ?? [];
          return { content: [{ type: "text", text: JSON.stringify(apps) }], isError: false };
        }
        case "list_windows": {
          const pid = await resolvePid(args.app_ref, input.signal);
          const raw = await callDriver("list_windows", withoutUndefined({ pid }), input.signal);
          const data = structured(raw);
          const windows = Array.isArray(data) ? data : (data?.windows ?? []);
          return { content: [{ type: "text", text: JSON.stringify(windows) }], isError: false };
        }
        case "get_app_state":
          return await getAppState(input, args);
        case "left_click":
          return await clickTool(input, args, args.mouse_button ?? "left");
        case "left_click_drag":
          return await dragTool(input, args);
        case "scroll":
          return await scrollTool(input, args);
        case "type":
          return await typeTool(input, args);
        case "key":
          return await keyTool(input, args);
        case "paste":
          return await pasteTool(input, args);
        case "set_value":
          return await setValueTool(input, args);
        case "select_text":
          return unavailable("select_text");
        case "perform_action":
          return unavailable("perform_action");
        case "request_access": {
          const raw = await callDriver("check_permissions", {}, input.signal);
          const result = projectDriverResult(raw);
          return {
            ...result,
            isError: false,
            structuredContent: { granted: true, capabilities: args.capabilities ?? "all" },
          };
        }
        case "stop_computer_control": {
          const raw = await callDriver("end_session", {}, input.signal);
          return projectDriverResult(raw);
        }
        default:
          return {
            content: [{ type: "text", text: `unknown Computer Use tool: ${toolName}` }],
            isError: true,
            structuredContent: { code: "INTERNAL" },
          };
      }
    } catch (error) {
      if (error?.code === "STALE_STATE" || error?.code === "INVALID_APP") {
        return {
          content: [{ type: "text", text: error.message }],
          isError: true,
          structuredContent: { code: error.code },
          _meta: { actionSent: false, errorCode: error.code },
        };
      }
      return projectDriverError(toolName, error);
    }
  }

  return { execute, observations };
}