/**
 * MCP 工具结果的读取层。
 *
 * broker 返回的是标准 MCP `CallToolResult` 信封，但 CUA 的生产方把结构化信息
 * 分散在三处：信封顶层、`structuredContent`、以及 text block 里的 JSON 字符串。
 * 历史上还出现过放在图片相邻 `image_ref` 块里的 frame_id。
 *
 * 本模块把这些形态统一成 SDK 内部可用的读数，**并且刻意保真**：空数组和「拿不到
 * 列表」必须能区分，「有图」和「要了图但没给」也必须能区分。把任何一种歧义
 * 抹平，模型就会用自己的猜测补上，而它的猜测通常是错的。
 */

import { ComputerUseError } from "./computer-use-errors.mjs";
import { BROKER_CODE_TO_SDK_CODE } from "./computer-use-errors.mjs";

/** Helper 冷启动时返回的非 error 信封类型。 */
const NOT_READY_KIND = "CUA_NOT_READY";
/** 冷启动重试的次数上限。 */
const NOT_READY_MAX_ATTEMPTS = 6;
/** 冷启动重试的退避序列，最后一次沿用末位。 */
const NOT_READY_BACKOFF_MS = [250, 500, 750, 1000, 1500];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 解析一段 JSON 文本，**排除数组**。
 *
 * 用于「这里期待一个对象」的场合：返回值 `undefined` 让调用方走进
 * 「不是对象」的分支，而不是把一个数组当成记录字段去读。
 */
function parseJsonObject(text) {
  if (typeof text !== "string") return undefined;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析一段 JSON 文本，**允许任何 JSON 值**（含数组与 `null`）。
 *
 * 与 {@link parseJsonObject} 分开是必要的：`list_apps` 的信封正文是一个裸 JSON
 * 数组，若用只收对象的解析器去读，紧随其后的数组分支就成了永远进不去的死代码，
 * 结果是 `listApps()` 恒返回空。模型据此判定「应用列表为空」，然后去请求权限、
 * 用 shell 排查环境，白绕好几个回合。
 */
function parseJsonAny(text) {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** 取出结果里所有 text block 的文本。 */
function collectTexts(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") texts.push(block.text);
  }
  return texts;
}

/** 取出结果里所有能解析成对象的 JSON 文本块。 */
function collectJsonRecords(result) {
  const records = [];
  for (const text of collectTexts(result)) {
    const parsed = parseJsonObject(text);
    if (parsed) records.push(parsed);
  }
  return records;
}

/** 收据里SDK 关心的字段。出现位置不固定，所以按「先见到先用」合并。 */
const RECEIPT_KEYS = Object.freeze([
  "state_id",
  "frame_id",
  "action_sent",
  "dispatch_status",
  "state_sync_status",
  "code",
  "reason",
  "snapshot_mode",
  "base_state_id",
]);

/**
 * 从信封里挖出结构化收据。
 *
 * 三个来源都要查：信封顶层、`structuredContent`、text block 里的 JSON（含它的
 * `action_outcome` 嵌套）。同名的键先见到为准——顶层是生产方最明确的表态，
 * 文本块只是兜底。
 */
function readReceipt(result) {
  const sources = [];
  if (result && typeof result === "object") sources.push(result);
  const structured = result?.structuredContent;
  if (structured && typeof structured === "object") sources.push(structured);
  for (const record of collectJsonRecords(result)) {
    sources.push(record);
    if (record.action_outcome && typeof record.action_outcome === "object") {
      sources.push(record.action_outcome);
    }
  }
  const receipt = {};
  for (const source of sources) {
    for (const key of RECEIPT_KEYS) {
      if (receipt[key] === undefined && source[key] !== undefined) receipt[key] = source[key];
    }
  }
  return receipt;
}

/**
 * frame_id 的真实载体是图片相邻的 `image_ref` 文本块
 * （`{"image_ref":{"frame_id":...}}`），不在收据顶层。两处都读，因为
 * `image_ref` 才是精确栅格契约的签发位置。
 */
function readFrameId(result, receipt) {
  if (typeof receipt.frame_id === "string") return receipt.frame_id;
  for (const record of collectJsonRecords(result)) {
    const frameId = record.image_ref?.frame_id;
    if (typeof frameId === "string") return frameId;
  }
  return undefined;
}

/** broker 侧的错误码。取不到就返回 undefined，由调用方落到 INTERNAL。 */
function readBrokerCode(result, receipt) {
  for (const record of collectJsonRecords(result)) {
    const code = record.code ?? record.error?.code;
    if (typeof code === "string") return code;
  }
  return typeof receipt.code === "string" ? receipt.code : undefined;
}

/**
 * 给人看的一句话。
 *
 * 优先取生产方 JSON 里的 `message`——那是针对这次失败写的；退化到第一个非 JSON
 * 的纯文本；再退化到第一个文本块；最后才用调用方的兜底句。
 */
function readMessage(result, fallback) {
  const texts = collectTexts(result);
  for (const record of collectJsonRecords(result)) {
    if (typeof record.message === "string" && record.message) return record.message;
  }
  const plain = texts.find((text) => text && !parseJsonObject(text));
  return plain ?? texts[0] ?? fallback;
}

/**
 * 「有图」的判定：返回图片字节，没有则 undefined。
 *
 * 注意这与「要了图」是两件事。调用方必须自己区分，否则会把「请求了像素但没拿到」
 * 当成「没请求像素」，而那恰恰是隐藏窗口 / 栅格 fail-closed 的信号。
 */
function readImageBytes(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  for (const block of blocks) {
    if (block?.type === "image" && typeof block.data === "string") {
      return Uint8Array.from(Buffer.from(block.data, "base64"));
    }
  }
  return undefined;
}

/**
 * frame authority 文本块的形状：只有一个 `image_ref` 键。
 *
 * 它是栅格契约的签发载体，所以要跟普通文本区别对待——走宿主的 structured sink
 * 而不是 `write`。
 */
function isFrameAuthorityText(value) {
  const parsed = parseJsonObject(value);
  return Boolean(
    parsed && Object.keys(parsed).length === 1 && Object.hasOwn(parsed, "image_ref"),
  );
}

/** Helper 冷启动的 not-ready 信封；不是失败，是「稍等再试同一个调用」。 */
function readNotReady(result) {
  if (result?.isError === true) return undefined;
  for (const record of collectJsonRecords(result)) {
    if (record.kind === NOT_READY_KIND) return record;
  }
  return undefined;
}

/**
 * 把一次调用结果归一成「成功返回收据 / 失败抛错」。
 *
 * `possibly_sent` 是本模块唯一需要小心的分支：broker 说「我可能已经下发了」，
 * 但 `isError` 是 false。此时必须 reject 并让 `actionSent` 为 true，迫使模型先
 * 重新观察。早先的做法是当成成功、附加一段提示文本，而模型经常读漏那段文本，
 * 于是盲重试一个可能已经落地的非幂等动作。
 */
function assertUsable(methodName, result) {
  const receipt = readReceipt(result);
  const failed = result?.isError === true;
  const dispatch = receipt.dispatch_status;
  if (!failed && dispatch !== "possibly_sent") return receipt;
  const brokerCode = readBrokerCode(result, receipt);
  const code = failed ? (BROKER_CODE_TO_SDK_CODE[brokerCode] ?? "INTERNAL") : "TIMEOUT";
  throw new ComputerUseError(readMessage(result, `${methodName} failed`), {
    code,
    actionSent: receipt.action_sent === true || dispatch === "possibly_sent",
    dispatchStatus: dispatch,
    details: { method: methodName, ...(brokerCode ? { brokerCode } : {}) },
  });
}

/**
 * 观察结果的结构化事实。
 *
 * 合并顺序：`structuredContent` 打底，JSON 文本块补充，树文本兜底 `text`。
 * 缺 `state_id` / `elements` / `app` / `window` 中任何一项都 fail closed——
 * 让模型拿着 undefined 去猜，比直接报错危险得多。
 */
function readAppState(methodName, result) {
  const structured =
    result?.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : {};
  const state = { ...structured };
  for (const record of collectJsonRecords(result)) {
    for (const key of [
      "state_id",
      "app",
      "window",
      "elements",
      "text",
      "snapshot_mode",
      "base_state_id",
    ]) {
      if (state[key] === undefined && record[key] !== undefined) state[key] = record[key];
    }
  }
  if (state.text === undefined) {
    const tree = collectTexts(result).find((text) => !parseJsonObject(text));
    if (tree) state.text = tree;
  }
  // 缺哪一项必须写进消息。早先这里只说「重新跑一遍 bootstrap」，模型照做两次、
  // 次次失败，然后升级去请求权限并用 shell 排查环境；而事后从转录本也回溯不到
  // 缺了什么，因为结果里只剩那句话。不可自愈又不可诊断的故障最难收场。
  const missing = [
    typeof state.state_id !== "string" ? "state_id" : null,
    Array.isArray(state.elements) ? null : "elements",
    state.app ? null : "app",
    state.window ? null : "window",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new ComputerUseError(
      `${methodName} returned no usable accessibility state: missing ${missing.join(", ")}. ` +
        "A hidden app with no open window can produce this, and re-observing will not change it. " +
        "Check listApps() for the app's state, or ask the user to open a window. " +
        "Do not infer a state_id from prose.",
      { code: "STRUCTURED_STATE_UNAVAILABLE", details: { method: methodName, missing } },
    );
  }
  return state;
}

/**
 * 生产方随观察附带的告知性文本（`[effect_evidence unchanged]`、`[screenshot_blank]`）。
 *
 * 它们以独立 text block 下发，而树文本是另一块。取的时候排除树文本本身、排除
 * JSON 块、排除 frame authority 块——后两者不是给人看的。
 *
 * 挂在树文本后面而不是另开通道：模型常写 `{ emit: false }` 再自行过滤，附加在
 * 返回值里两条路都覆盖到。
 */
function readAdvisoryTexts(result, treeText) {
  const advisories = collectTexts(result).filter(
    (text) =>
      text && text !== treeText && !parseJsonObject(text) && !isFrameAuthorityText(text),
  );
  return advisories.length > 0 ? `\n${advisories.join("\n")}` : "";
}

/**
 * 投给宿主的结构化负载：去掉元素全表。
 *
 * 观察结果的 `structuredContent` 带着整棵 AX 树的元素数组，宿主会把它序列化进
 * **模型可见**的工具消息。打开一个有 180+ 元素的应用时单次输出可达 140KB，
 * 而元素表对模型是纯重复——它读的是同一次观察里已渲染好的树文本。
 *
 * 宿主侧唯一的消费者是工具结果展示面板，所以保留能标识状态的小字段，把
 * `elements` 换成计数、丢掉 `text`（它已在 content 里）。非观察类结果没有
 * elements，原样透传。
 */
function stripForDisplay(structured) {
  if (!Array.isArray(structured.elements)) return structured;
  const { elements, text: _text, ...rest } = structured;
  return { ...rest, element_count: elements.length };
}

/**
 * 把观察结果投影给宿主：图片与 frame authority 走 structured sink，文本走 write。
 *
 * 成功的纯文本动作不产生任何正文——否则会和观察结果拼成两段输出。
 */
function projectToHost(globals, result) {
  const sink = globals.nodeRepl?.emitStructuredResult;
  if (typeof sink !== "function" || !result || !Array.isArray(result.content)) return;
  const blocks = result.content;
  const media = blocks.filter(
    (block) =>
      block?.type === "image" ||
      (block?.type === "text" && isFrameAuthorityText(block.text)),
  );
  if (media.length > 0) {
    // 带图的观察必须保留自己的 structuredContent。
    //
    // 这里原先无条件丢弃它，于是「要了像素」那次的元数据一个字都不显示，模型看到
    // 的是同 cell 里另一次没有图的调用的 structuredContent——也就是绑定时的隐藏
    // 全量观察。可观测后果：请求了像素、图也确实附上了，`has_image` 却恒为 false。
    // 更危险的是 `window` 与 `state_id` 也是探针那次的：探针早于本 cell 的动作，
    // 弹窗在动作后才出现时，模型读到的是漂移前的窗口，据此判断「对话框没出现」。
    //
    // 丢弃的原意是防元素全表泄漏，而那件事 stripForDisplay 已经做了，不需要整块丢。
    const { structuredContent: raw, ...rest } = result;
    const structured = raw && typeof raw === "object" ? stripForDisplay(raw) : undefined;
    sink({ ...rest, content: media, ...(structured ? { structuredContent: structured } : {}) });
    return;
  }
  if (result.isError === true) {
    sink(result);
    return;
  }
  const meta = result._meta && typeof result._meta === "object" ? result._meta : undefined;
  const structured =
    result.structuredContent && typeof result.structuredContent === "object"
      ? result.structuredContent
      : undefined;
  if (!meta && !structured) return;
  sink({
    content: [],
    ...(structured ? { structuredContent: stripForDisplay(structured) } : {}),
    ...(meta ? { _meta: meta } : {}),
  });
}

/**
 * 观察方法自行展示结果。
 *
 * 纪律本该由 SDK 承担，而不是写在 SKILL 里让模型记住。`{emit:false}` 留给
 * 「用代码判断但不想污染上下文」的场合。展示失败不能连带功能调用失败。
 */
function emitToRepl(globals, text, options) {
  if (options?.emit === false) return;
  try {
    globals.nodeRepl?.write?.(text);
  } catch {
    // 展示是副作用，失败不影响本次调用的结果。
  }
}

/**
 * 包住「调用 + 冷启动重试 + 投影」。
 *
 * not-ready 是 Helper 懒启动的正常一步：payload 明确要求稍等后重试同一个调用。
 * 只在 `retryable` 为真时重试——possibly_sent 的动作绝不重放。
 * 等到上限时把生产方自己的话和 reasonCode 交给模型，不替换成通用句子。
 */
export function createInvoker(bridge, globals) {
  return async function invoke(methodName, args) {
    for (let attempt = 0; ; attempt += 1) {
      bridge.assertAvailable?.();
      const result = await bridge.call(methodName, args ?? {});
      const notReady = readNotReady(result);
      if (!notReady) {
        projectToHost(globals, result);
        return result;
      }
      const retryable = notReady.retryable === true;
      if (!retryable || attempt >= NOT_READY_MAX_ATTEMPTS - 1) {
        throw new ComputerUseError(
          `${methodName}: ${notReady.message ?? "Computer Use is not ready."}`,
          {
            code: retryable ? "TIMEOUT" : "CONTROLLER_BUSY",
            details: {
              method: methodName,
              reasonCode: notReady.reasonCode,
              retryable,
              attempts: attempt + 1,
            },
          },
        );
      }
      await sleep(NOT_READY_BACKOFF_MS[Math.min(attempt, NOT_READY_BACKOFF_MS.length - 1)]);
    }
  };
}

export {
  assertUsable,
  collectTexts,
  emitToRepl,
  isFrameAuthorityText,
  parseJsonAny,
  parseJsonObject,
  projectToHost,
  readAdvisoryTexts,
  readAppState,
  readFrameId,
  readImageBytes,
  readMessage,
  readNotReady,
  readReceipt,
  stripForDisplay,
};
