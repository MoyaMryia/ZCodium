/**
 * Computer Use SDK —— 模型可见面与 Codex 的 `cua` 同构（不含 browser 半边）。
 *
 * 三条原则：
 *   R1 同名同签 —— Codex 有的方法，名字、位置参数顺序、选项键名、返回类型一致。
 *   R2 Codex 没有的能力先问能不能删；留下的只能出现在可选选项键、尾部可选参数，
 *      或 `cua.computer` 逃逸口里。`Target` 上的附加可枚举成员数为 0。
 *   R3 安全语义只藏不删 —— state_id 强校验、frame 精确栅格、possibly_sent 防重放、
 *      controller lease、kill switch 全部保留，改为内部字段或类型化错误。
 *
 * 与 Codex 的两处不可对齐：
 *   1. node_repl 的 Worker 每次 `js` 调用都是全新的，`const app` 活不到下一个 cell。
 *      stateId / frameId / diff 基线由 shared host 的 runtime session 持有，所以下一个
 *      cell 里 `getApp` 是重新绑定而非重新观察。
 *   2. 动作失败抛 ComputerUseError 并带 actionSent —— Codex 的动作全是 Promise<void>，
 *      把「可能已下发」的信息扔了；ZCode 这条语义是事故驱动的，必须保留。
 *
 * 不融合 Browser Use：这里不存在 browsers / getBrowser / createBrowserTab / getTab；
 * `State` 没有 `browsers` 键；`Target` 只被 App 实现，不与 browser 的 Tab 共享类型。
 *
 * 模块划分：
 *   computer-use-errors.mjs    错误对象与重试策略
 *   computer-use-envelope.mjs  MCP 结果的读取与投影
 *   computer-use-target.mjs    App / Window 交互面
 *   computer-use-keys.mjs      键位输入侧规范化
 *   本文件                    装配、绑定、逃逸口
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ComputerUseError } from "./computer-use-errors.mjs";
import {
  assertUsable,
  collectTexts,
  createInvoker,
  emitToRepl,
  parseJsonAny,
  readAppState,
} from "./computer-use-envelope.mjs";
import {
  buildAlternateAppRef,
  buildAppRef,
  createAppTarget,
  createBinding,
  isAppUnresolved,
} from "./computer-use-target.mjs";
import { normalizeKeyChord } from "./computer-use-keys.mjs";

/** host 侧 bridge 的注入点。字符串是跨模块契约，改动必须两侧同步。 */
const BRIDGE_SYMBOL = Symbol.for("zcode.node-repl.computer-use-bridge");

/** 存活的工具面（= `cua.computer`）。协议层的事实来源在 host 的 manifest。 */
const COMPUTER_METHOD_NAMES = Object.freeze([
  "list_apps",
  "list_windows",
  "get_app_state",
  "left_click",
  "scroll",
  "left_click_drag",
  "type",
  "set_value",
  "select_text",
  "key",
  "perform_action",
  "paste",
  "request_access",
  "stop_computer_control",
]);

/**
 * 平台面收缩：某些工具在某些平台上**不存在**。
 *
 * 事实来源同为 host manifest 的 TOOL_PLATFORM_EXCLUSIONS —— 那边不注册 handler，
 * 这边不挂到 `cua.computer` 上，两侧必须一致，否则模型看得见一个调用即报错的方法，
 * 又会去猜替代写法。
 *
 * 启动与激活已并入 get_app_state 的透明拉起，与 Codex 一致（它的 mac 面本来就没有
 * 启动/激活原语），于是这张表暂时为空：留着它是因为「按平台收缩」这个机制本身还需要，
 * 下一个平台专属工具直接往里加。
 */
const PLATFORM_EXCLUDED_METHODS = Object.freeze({});

/** 绑定前的两次观察都用的同一组参数：全量、不展示、不当基线。 */
const PROBE_OBSERVATION = Object.freeze({
  include_screenshot: false,
  disable_diffing: true,
  tree_shown_to_model: false,
});

/**
 * 把 `cua.computer.*` 的返回值解封。
 *
 * 此前原样返回 MCP 信封，于是模型拿到的是
 * `{content:[{type:"text",text:"[...]"}],_meta:{…}}`，还得自己
 * `JSON.parse(r.content[0].text)`。而 `_meta` 按设计就是**宿主专用**的——
 * projectToHost 已经单独把它送给宿主展示，泄漏给模型是契约违规。
 *
 * 只在「单一 text block」这种明确形态上解封；多块 / 图像等一律原样返回，
 * 避免把一个我们不认识的形状猜成裸值。
 */
function unwrapEnvelope(result) {
  if (result === null || typeof result !== "object") return result;
  if (!Array.isArray(result.content)) return result;
  const texts = result.content.filter(
    (block) => block && block.type === "text" && typeof block.text === "string",
  );
  if (texts.length !== 1 || result.content.length !== 1) return result;
  try {
    return JSON.parse(texts[0].text);
  } catch {
    return texts[0].text;
  }
}

/**
 * 装配 Computer Use 运行时。
 *
 * @param {{ globals: Record<string, any> }} input
 * @returns {Promise<object>} `cua` 对象，同时被挂到 `globals.agent.computerUse`
 */
export async function setupComputerUseRuntime({ globals }) {
  const bridge = globals[BRIDGE_SYMBOL];
  if (!bridge || typeof bridge !== "object" || typeof bridge.call !== "function") {
    throw new Error(
      "Computer Use runtime bridge is unavailable. Use Computer Use from a ZCode desktop or shared-host session.",
    );
  }
  bridge.assertAvailable?.();

  const platform = globals.process?.platform ?? process.platform;
  const invoke = createInvoker(bridge, globals);
  const ctx = { invoke, globals, platform };

  /**
   * 绑定一个 app。
   *
   * 绑定即观察（对齐 Codex）：返回前做一次全量观察用于身份解析、窗口校验与索引
   * 基线，但那棵树**不展示**给模型——node_repl 每个 cell 都是全新 Worker、每个 cell
   * 都要重新 getApp，那次"顺便展示"会从一次性省一个往返变成每个 cell 都多一棵注定
   * 作废的树。想看状态就显式 getAXState()。
   */
  const bindApp = async (target, windowId) => {
    let objectRef;
    let label = typeof target === "string" ? target : "";
    // 也接受工具层那种 app_ref 对象。SKILL 把绑定面和逃逸口并排放着，模型学到
    // `{bundle_id: ...}` 之后很自然会把它传给 getApp。对象形态没有歧义，直接透传
    // 比让它退回去改写更省一次往返。
    if (target && typeof target === "object" && !Array.isArray(target)) {
      const direct = windowId === undefined ? { ...target } : { ...target, window_id: windowId };
      if (
        typeof direct.name !== "string" &&
        typeof direct.bundle_id !== "string" &&
        typeof direct.pid !== "number"
      ) {
        throw new ComputerUseError(
          "getApp needs an app display name, a bundle id, or {name|bundle_id|pid}",
          { code: "INVALID_APP" },
        );
      }
      objectRef = direct;
      label = String(direct.name ?? direct.bundle_id ?? direct.pid);
    } else if (typeof target !== "string" || !target.trim()) {
      throw new ComputerUseError(
        "getApp needs an app display name, a bundle id, or {name|bundle_id|pid}",
        { code: "INVALID_APP" },
      );
    }

    let appRef = objectRef ?? buildAppRef(target, windowId);
    const binding = createBinding(label, appRef);
    const app = createAppTarget(ctx, binding);

    let result = await invoke("get_app_state", { app_ref: appRef, ...PROBE_OBSERVATION });
    // 只有字符串需要猜字段；对象形态是显式的，猜错的是调用方而不是我们。
    if (objectRef === undefined && isAppUnresolved(result)) {
      appRef = buildAlternateAppRef(target, windowId);
      binding.appRef = appRef;
      result = await invoke("get_app_state", { app_ref: appRef, ...PROBE_OBSERVATION });
    }
    assertUsable("get_app_state", result);
    const state = readAppState("get_app_state", result);
    binding.stateId = state.state_id;
    binding.elements = state.elements;

    // 绑定成功后把 app_ref 收敛成**解析出来的身份**，不再继续拿模型给的原始字符串。
    //
    // 观察路径宽容（按名字找不到活动应用会走透明拉起，LaunchServices 查表能把
    // 本地化名解成 bundle id），输入路径严格（键盘只按活动应用严格匹配）。不收敛的
    // 话，`getApp("地图")` 观察成功而同一个 cell 里的 pressKey 报
    // 「did not resolve to a unique live application」。
    //
    // 观察结果里本来就带着已解析的身份（state.app.pid / bundle_id）。收敛之后
    // 本地化名、模糊名、大小写差异都只在第一跳解决一次，后续所有路径拿到的都是
    // 无歧义身份。两个字段都给：pid 精确，bundle_id 供 broker 侧交叉校验身份。
    // window_id 若已绑定必须保留——它决定 macOS 后台键盘的 synthetic-focus session。
    const resolvedPid = typeof state.app?.pid === "number" ? state.app.pid : undefined;
    const resolvedBundleId =
      typeof state.app?.bundle_id === "string" && state.app.bundle_id.trim()
        ? state.app.bundle_id
        : undefined;
    if (resolvedPid !== undefined || resolvedBundleId !== undefined) {
      const boundWindowId =
        typeof appRef?.window_id === "number" ? { window_id: appRef.window_id } : {};
      appRef = {
        ...(resolvedPid !== undefined ? { pid: resolvedPid } : {}),
        ...(resolvedBundleId !== undefined ? { bundle_id: resolvedBundleId } : {}),
        ...boundWindowId,
      };
      binding.appRef = appRef;
    }

    // 判据取自**最终的 appRef**，不是位置参数 windowId。
    //
    // `getWindow(target, id)` 那种位置参数形态和 `getApp({pid, window_id})` 都能钉
    // 窗口，走对象路径时 windowId 恒为 undefined，只认位置参数会把这道 fail-closed
    // 整个跳过：Helper 静默降级到最前窗口、只回一句 note，模型在错窗口上继续操作。
    // 两种钉法必须同一套校验。
    const boundWindow = typeof appRef?.window_id === "number" ? appRef.window_id : windowId;
    if (boundWindow !== undefined && state.window?.window_id_fallback === true) {
      throw new ComputerUseError(
        `Window ${boundWindow} of ${label} could not be resolved; the Helper fell back to the frontmost window. Call agent.computerUse.computer.list_windows to pick a fresh window_id.`,
        { code: "STALE_STATE", details: { app: label, windowId: boundWindow } },
      );
    }

    // 结构化元素视图。Codex 的 Target 只给字符串，但模型写的是代码，单 cell 内
    // 「观察 → 找元素 → 动作」能省一次往返；树被按优先级裁剪时，它还是模型拿到
    // 隐藏元素索引的唯一途径。保持 enumerable:false 只是为了不进 Object.keys ——
    // R2 说的是与 Codex 逐字对齐的**可枚举**面，不是禁止具名逃逸口。
    Object.defineProperty(app, "elements", {
      enumerable: false,
      value: async () => {
        // 与 getScreenshot 同档的静默观察：结果只回给 JS、不 emit 任何东西，所以
        // `tree_shown_to_model: false` 必须给。漏了的后果是索引位移台账被一棵模型
        // 没看过的树覆盖，校验退化成当前树跟当前树自比，静默点错元素的保护失效。
        // 这次 capture 还把 Helper 的 diff 基线推到未展示的树上，所以清 treeSeen
        // 让下一次 getAXState 强制整树。
        const fresh = readAppState(
          "get_app_state",
          await invoke("get_app_state", { app_ref: appRef, tree_shown_to_model: false }),
        );
        binding.stateId = fresh.state_id;
        binding.elements = fresh.elements;
        binding.treeSeen = false;
        return fresh.elements;
      },
    });
    return app;
  };

  const inventory = async (options) => {
    const result = await invoke("list_apps", {});
    assertUsable("list_apps", result);
    const apps = [];
    for (const text of collectTexts(result)) {
      const parsed = parseJsonAny(text);
      if (Array.isArray(parsed?.apps)) apps.push(...parsed.apps);
      else if (Array.isArray(parsed)) apps.push(...parsed);
    }
    const state = { apps };
    emitToRepl(globals, JSON.stringify(state, null, 2), options);
    return state;
  };

  // `cua.computer` —— 平台特定逃逸口。内容是存活的 14 个工具，入参 schema 保留。
  const computer = Object.create(null);
  Object.defineProperty(computer, "target", {
    enumerable: true,
    value: platform === "darwin" ? "mac" : platform === "win32" ? "windows" : "linux",
  });
  const excluded = new Set(PLATFORM_EXCLUDED_METHODS[platform] ?? []);
  for (const methodName of COMPUTER_METHOD_NAMES) {
    if (excluded.has(methodName)) continue;
    Object.defineProperty(computer, methodName, {
      enumerable: true,
      value: async (args = {}) => unwrapEnvelope(await invoke(methodName, args)),
    });
  }

  const cua = {
    async getState(options) {
      return await inventory(options);
    },
    async getApp(target) {
      return await bindApp(target);
    },
    async listApps(options) {
      return (await inventory(options)).apps;
    },
    computer: Object.freeze(computer),
    async requestAccess(capabilities) {
      const result = await invoke("request_access", capabilities ? { capabilities } : {});
      assertUsable("request_access", result);
      const texts = collectTexts(result);
      return parseJsonAny(texts[0]) ?? { ready: true };
    },
    async stop(reason) {
      const result = await invoke("stop_computer_control", reason ? { reason } : {});
      assertUsable("stop_computer_control", result);
    },
  };

  // 未文档化成员：窗口绑定。Codex 把窗口概念按平台分裂（macOS 面没有窗口寻址，
  // Windows 的 window2 面整套以 Window 对象寻址），ZCode 三平台统一命名做不了那种
  // 分裂，所以窗口寻址留在逃逸口 + 这个未文档化入口。
  Object.defineProperty(cua, "getWindow", {
    enumerable: false,
    value: async (target, windowId) => await bindApp(target, windowId),
  });

  // 入口是 `agent.computerUse`（ZCode 自己的命名空间约定，与 agent.documentation /
  // agent.browsers 并列）。codex 用的是裸 `cua` 全局；这一处是有意的分歧。
  // 平铺的 14 个工具在 `agent.computerUse.computer.*` 下（COMPUTER_METHOD_NAMES）。
  const agent = (globals.agent ??= {});
  agent.computerUse = cua;

  const previousDocumentation = agent.documentation;
  const previousGet =
    previousDocumentation && typeof previousDocumentation.get === "function"
      ? previousDocumentation.get.bind(previousDocumentation)
      : undefined;
  agent.documentation = Object.freeze({
    get: async (name) => {
      // Browser Use 的文档 loader 必须原样转交 —— CUA 只认自己那一个名字。
      if (name !== "computer-use") {
        if (previousGet) return await previousGet(name);
        throw new Error(`Unknown documentation entry: ${name}`);
      }
      if (typeof bridge.documentationRoot !== "string") {
        throw new Error("Computer Use documentation is unavailable");
      }
      return await readFile(join(bridge.documentationRoot, "computer-use.md"), "utf8");
    },
  });

  return cua;
}

export { BRIDGE_SYMBOL, COMPUTER_METHOD_NAMES, PLATFORM_EXCLUDED_METHODS, ComputerUseError, normalizeKeyChord };
