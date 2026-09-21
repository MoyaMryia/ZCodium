/**
 * App / Window 的交互面。
 *
 * 模型看到的 12 个方法与 Codex 的 `Target` 同名同签；ZCode 的附加能力只出现在
 * 可选选项键里，不增加新成员名。这与 Browser Use 不共享任何类型——这里没有
 * browsers / getBrowser / getTab。
 *
 * 安全语义全部保留但改为内部机制：索引必须先有观察、坐标绑定到最近一次可动作
 * 栅格、动作失败带 possibly_sent、窗口解析失败 fail-closed。
 */

import { ComputerUseError } from "./computer-use-errors.mjs";
import { normalizeKeyChord } from "./computer-use-keys.mjs";
import {
  assertUsable,
  emitToRepl,
  readAdvisoryTexts,
  readAppState,
  readFrameId,
  readImageBytes,
} from "./computer-use-envelope.mjs";

/** 滚动方向，长写与单字母都收。 */
const SCROLL_DIRECTIONS = new Set(["up", "down", "left", "right", "u", "d", "l", "r"]);
const SCROLL_DIRECTION_LONG = { u: "up", d: "down", l: "left", r: "right" };

/** 鼠标键，长写与单字母都收。 */
const MOUSE_BUTTONS = {
  left: "left",
  right: "right",
  middle: "middle",
  l: "left",
  r: "right",
  m: "middle",
};

/**
 * number → 元素索引，`[x, y]` → 栅格像素。
 *
 * 索引按**该 app 最新一次观察**解析，wire 上只发 `{type:"element", index}`，
 * 由动作自带的 `app_ref` 说明作用域。这样模型永远不需要碰 frame_id。
 *
 * 仍然要求先有一次观察：没有观察就没有索引可言。自动补观察会把「模型以为点 A、
 * 实际点到 B」变成静默错误。
 */
function resolveTarget(binding, target, what) {
  if (typeof target === "number") {
    if (!Number.isInteger(target) || target < 0) {
      throw new ComputerUseError(
        `${what} element index must be a non-negative integer (got ${target})`,
        { code: "INTERNAL" },
      );
    }
    if (!binding.stateId) {
      // 报错要么给可直接粘贴的代码，要么就用散文描述。这里不能把显示名拼进代码
      // 位置：模型用 `getApp({pid: 2697})` 绑定时 label 就是 "2697"，拼出来是
      // `await 2697.getAXState()` 这种不合语法的代码；绑定中文名时同样如此。
      throw new ComputerUseError(
        `${what} needs a fresh accessibility state before an element index can be resolved. ` +
          "Call getAXState() on the bound app first (the object getApp(...) returned), then act in the same cell.",
        { code: "STALE_STATE", details: { need: "getAXState" } },
      );
    }
    return { type: "element", index: target };
  }
  if (Array.isArray(target) && target.length === 2) {
    const [x, y] = target;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) {
      throw new ComputerUseError(
        `${what} coordinate must be two non-negative integer pixels of the latest raster (got [${x}, ${y}])`,
        { code: "INTERNAL" },
      );
    }
    // 本 cell 没有取过栅格时不拒绝：工具层的坐标目标本来就允许省略 frame_id，
    // implicit 路径绑的是该会话最近一次可动作栅格。放宽之后安全性不变——帧过期、
    // 被替换、非可动作，以及 app_ref 与该帧真实 owner 不一致，都仍然 fail-closed；
    // 一次栅格都没有过时，broker 会给出明确的「no actionable frame」。
    return binding.frameId
      ? { type: "coordinate", frame_id: binding.frameId, x, y }
      : { type: "coordinate", x, y };
  }
  throw new ComputerUseError(
    `${what} target must be an element index (number) or a raster pixel ([x, y])`,
    { code: "INTERNAL" },
  );
}

/**
 * 一个字符串该当成 bundle id 还是 display name。
 *
 * 判据：含点、不含空格和斜杠（`com.apple.Notes`）。猜错时调用方会用
 * {@link alternateAppRef} 换字段重试一次，所以判据只影响首选顺序，不影响能不能成。
 */
function looksLikeBundleId(value) {
  return value.includes(".") && !/[\s/]/u.test(value);
}

function buildAppRef(value, windowId) {
  const field = looksLikeBundleId(value) ? "bundle_id" : "name";
  return { [field]: value, ...(windowId === undefined ? {} : { window_id: windowId }) };
}

function buildAlternateAppRef(value, windowId) {
  const field = looksLikeBundleId(value) ? "name" : "bundle_id";
  return { [field]: value, ...(windowId === undefined ? {} : { window_id: windowId }) };
}

/**
 * 「target app is not running」是 app 解析失败的信号。
 *
 * 只匹配语义核心，不匹配后半句：后半句随可执行建议演化，一个逗号加改写就能让
 * 备用查询一次都不执行，而调用方毫无感知。
 */
function isAppUnresolved(result) {
  if (!result?.isError) return false;
  const blocks = Array.isArray(result?.content) ? result.content : [];
  return blocks.some(
    (block) =>
      block?.type === "text" && typeof block.text === "string" && /target app is not running/u.test(block.text),
  );
}

/**
 * 按内容定位 `[start, length]`。
 *
 * `prefix` / `suffix` 用来消歧重复匹配；`selectionType` 把选区折叠成光标位置。
 * 匹配不唯一时抛 NOT_SELECTABLE 并报候选数——静默取第一个会让模型在错的位置编辑。
 */
function locateTextRange(binding, elementIndex, text, options) {
  if (text && typeof text === "object" && Number.isInteger(text.start)) {
    return [text.start, text.length ?? 0];
  }
  if (typeof text !== "string" || text.length === 0) {
    throw new ComputerUseError("selectText requires the text to locate", { code: "INTERNAL" });
  }
  const element = binding.elements?.[elementIndex];
  const value = typeof element?.value === "string" ? element.value : undefined;
  if (value === undefined) {
    throw new ComputerUseError(
      `selectText cannot locate text in element ${elementIndex}: the latest accessibility state exposed no value for it. Observe again, or use a range { start, length }.`,
      { code: "NOT_SELECTABLE", details: { elementIndex } },
    );
  }
  const needle = `${options?.prefix ?? ""}${text}${options?.suffix ?? ""}`;
  const hits = [];
  for (let at = value.indexOf(needle); at !== -1; at = value.indexOf(needle, at + 1)) {
    hits.push(at);
  }
  if (hits.length === 0) {
    throw new ComputerUseError(
      `selectText found no occurrence of the requested text in element ${elementIndex}`,
      { code: "NOT_SELECTABLE", details: { elementIndex } },
    );
  }
  if (hits.length > 1) {
    throw new ComputerUseError(
      `selectText matched ${hits.length} occurrences in element ${elementIndex}; disambiguate with prefix/suffix`,
      { code: "NOT_SELECTABLE", details: { elementIndex, matches: hits.length } },
    );
  }
  const start = hits[0] + (options?.prefix?.length ?? 0);
  const selectionType = options?.selectionType ?? "text";
  if (selectionType === "cursor_before") return [start, 0];
  if (selectionType === "cursor_after") return [start + text.length, 0];
  return [start, text.length];
}

/** 每个绑定目标在 Worker 内的视图；跨 cell 的真身由 shared host 的 session 持有。 */
function createBinding(label, appRef) {
  return {
    label,
    appRef,
    stateId: undefined,
    frameId: undefined,
    elements: undefined,
    // delta 的基线是否是模型**看过**的那棵树。见 createAppTarget 的 observe。
    treeSeen: false,
  };
}

/**
 * 观察与动作的共享实现。
 *
 * `observe` 同时服务「要树」和「只要图」两种请求，差别只在两个标志：
 * `include_screenshot` 与 `yieldsTree`。两者的组合决定了 diff 基线怎么走——
 * 这是本文件里最容易出错的地方，注释见下。
 */
function createAppTarget(ctx, binding) {
  const { invoke, globals, platform } = ctx;

  const observe = async (options, includeScreenshot, yieldsTree) => {
    // 字段名必须和 get_app_state 的 schema 一致：它是 `.strict()` 的，凭空发明的
    // 键会让每一次观察都被 unrecognized_keys 打回。
    const args = { app_ref: binding.appRef, include_screenshot: includeScreenshot };
    // 不变量：delta 只在基线是模型**看过**的树时才允许。
    //
    // Helper 的 diff 基线是「该 pid+窗口的上一次 capture」，不管发起者是谁、模型
    // 有没有看见。而绑定时会做一次全量但不展示的观察，那次 capture 就成了基线。
    // 于是模型第一次 getAXState 是对着一棵它从未见过的树做增量。
    //
    // 只截图的观察同样移动了 Helper 的基线却不给树文本，所以它把 treeSeen 清掉。
    if (yieldsTree === true && binding.treeSeen !== true) args.disable_diffing = true;
    if (options?.disableDiffing === true) args.disable_diffing = true;
    // yieldsTree=false（getScreenshot）不给树文本，所以它不能把自己算成基线。
    if (yieldsTree !== true) args.tree_shown_to_model = false;

    const result = await invoke("get_app_state", args);
    const receipt = assertUsable("get_app_state", result);
    const state = readAppState("get_app_state", result);
    binding.stateId = state.state_id;
    binding.treeSeen = yieldsTree === true;
    const frameId = readFrameId(result, receipt);
    if (typeof frameId === "string") binding.frameId = frameId;
    return { state, result };
  };

  const act = async (methodName, args) => {
    await assertUsable(methodName, await invoke(methodName, args));
    // 动作之后不再清 binding.stateId。
    //
    // 这条守卫原先存在，但它与我们的文档打架（文档照抄了 Codex 的动作目录块，
    // 里面就是 click(42) 紧跟 setValue(42)），且 Codex 没有任何等价物——它的模型面里
    // stateId/stale/generation 出现 0 次，失效判定在原生服务且是被动的。这条守卫
    // 也没有信息支撑：SDK 只知道"发生过动作"，不知道 UI 是否变化。真正知道的是
    // Helper——索引在观察时就已冻结成 native token，元素消失时它本来就 fail-closed。
    //
    // 所以保留冻结映射 + Helper 侧校验，不在客户端提前否决。
  };

  return {
    async getAXState(options) {
      const { state, result } = await observe(options, false, true);
      // 生产方的告知性块（effect_evidence / screenshot_blank）必须跟着树一起走，
      // 否则这条链路会把它们丢光。
      const text = `${state.text}${readAdvisoryTexts(result, state.text)}`;
      emitToRepl(globals, text, options);
      return text;
    },

    async getScreenshot(options) {
      // yieldsTree=false：只截图不给树文本，所以它不强制整树，也不能把自己算成基线。
      const { state, result } = await observe(options, true, false);
      const bytes = readImageBytes(result);
      if (!bytes) {
        // 措辞纪律：这里不能写「raise the window and retry」——那是直接教模型抢用户
        // 焦点，而后台截图本来就能拿到。真正常见的成因是应用被 ⌘H 隐藏：macOS 不渲染
        // 隐藏窗口，栅格必然 fail-closed，此时重试永远不会成功。所以把生产方给出的
        // 原因带上，并指回真正可走的 AX 路径——隐藏窗口的 accessibility 完全不受影响。
        throw new ComputerUseError(
          `Screenshot unavailable for ${binding.label}` +
            (state.non_actionable_reason ? ` (${state.non_actionable_reason})` : "") +
            (state.screenshot_blank ? " (the captured raster was blank)" : "") +
            ". The accessibility tree still works on a hidden or unrendered window: use " +
            "getAXState() and act on element indices. Do not activate the app; ask the user " +
            "to unhide the window if pixels are genuinely required.",
          { code: "ELEMENT_UNAVAILABLE", details: { app: binding.label } },
        );
      }
      return bytes;
    },

    async getAXStateAndScreenshot(options) {
      const { state, result } = await observe(options, true, true);
      const screenshot = readImageBytes(result);
      // 静默丢图是最难排查的一类缺陷：模型从"没收到图"只能猜原因，而它的猜测
      // （去抢用户焦点）恰恰是最坏的操作。请求了像素却没拿到，必须说清为什么、
      // 以及重试有没有用。
      const note =
        screenshot || !state.non_actionable_reason
          ? ""
          : `\n[screenshot unavailable: ${state.non_actionable_reason}]` +
            " A hidden or minimized window produces this persistently, so re-observing will not" +
            " help. The accessibility tree above is complete — act on element indices. Do not" +
            " activate the app.";
      const text = `${state.text}${readAdvisoryTexts(result, state.text)}`;
      emitToRepl(globals, `${text}${note}`, options);
      return screenshot ? { state: text, screenshot } : { state: text };
    },

    async paste(text, options) {
      if (typeof text !== "string") {
        throw new ComputerUseError("paste requires text", { code: "INTERNAL" });
      }
      await act("paste", {
        app_ref: binding.appRef,
        text,
        format: options?.format ?? "text",
      });
    },

    async click(target, options) {
      const bound = resolveTarget(binding, target, "click");
      const button = options?.mouseButton ? MOUSE_BUTTONS[options.mouseButton] : "left";
      if (!button) {
        throw new ComputerUseError(
          `click mouseButton must be left, right or middle (got ${options.mouseButton})`,
          { code: "INTERNAL" },
        );
      }
      await act("left_click", {
        target: bound,
        // 索引作用域：少了 app_ref，多 app 会话里的索引会退到"全局最近一次观察"，
        // 可能属于另一个 app。
        app_ref: binding.appRef,
        mouse_button: button,
        click_count: options?.clickCount ?? 1,
        ...(options?.modifiers ? { modifiers: options.modifiers } : {}),
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async drag(from, to, options) {
      await act("left_click_drag", {
        from_target: resolveTarget(binding, from, "drag from"),
        to: resolveTarget(binding, to, "drag to"),
        app_ref: binding.appRef,
        ...(options?.modifiers ? { modifiers: options.modifiers } : {}),
      });
    },

    async pressKey(key, options) {
      if (typeof key !== "string" || !key.trim()) {
        throw new ComputerUseError("pressKey requires a key or chord", { code: "INTERNAL" });
      }
      await act("key", {
        text: normalizeKeyChord(key, platform),
        app_ref: binding.appRef,
        ...(options?.holdSeconds !== undefined ? { hold_seconds: options.holdSeconds } : {}),
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async scroll(target, direction, pages, options) {
      const dir = typeof direction === "string" ? direction.trim().toLowerCase() : "";
      if (!SCROLL_DIRECTIONS.has(dir)) {
        throw new ComputerUseError(
          `scroll direction must be up, down, left or right (got ${direction})`,
          { code: "INTERNAL" },
        );
      }
      await act("scroll", {
        target: resolveTarget(binding, target, "scroll"),
        app_ref: binding.appRef,
        scroll_direction: SCROLL_DIRECTION_LONG[dir] ?? dir,
        scroll_amount: pages === undefined ? 1 : pages,
        ...(options?.strategy ? { strategy: options.strategy } : {}),
      });
    },

    async selectText(elementIndex, text, options) {
      const bound = resolveTarget(binding, elementIndex, "selectText");
      // range 由 SDK 在**已观察到的元素 value** 上本地算出，不需要额外的 broker
      // 往返：value 就在上一次 getAXState 的结构化结果里。
      const range = locateTextRange(binding, elementIndex, text, options);
      await act("select_text", { target: bound, app_ref: binding.appRef, text_range: range });
    },

    async setValue(elementIndex, value) {
      if (typeof value !== "string") {
        throw new ComputerUseError("setValue requires a string value", { code: "INTERNAL" });
      }
      await act("set_value", {
        target: resolveTarget(binding, elementIndex, "setValue"),
        app_ref: binding.appRef,
        value,
      });
    },

    async typeText(text) {
      if (typeof text !== "string") {
        throw new ComputerUseError("typeText requires text", { code: "INTERNAL" });
      }
      await act("type", { text, app_ref: binding.appRef });
    },

    async performSecondaryAction(elementIndex, action) {
      if (typeof action !== "string" || !action.trim()) {
        throw new ComputerUseError(
          "performSecondaryAction requires an action advertised by the element; do not guess one",
          { code: "ACTION_UNAVAILABLE" },
        );
      }
      await act("perform_action", {
        target: resolveTarget(binding, elementIndex, "performSecondaryAction"),
        app_ref: binding.appRef,
        action,
      });
    },
  };
}

export {
  buildAlternateAppRef,
  buildAppRef,
  createAppTarget,
  createBinding,
  isAppUnresolved,
  locateTextRange,
  resolveTarget,
};
