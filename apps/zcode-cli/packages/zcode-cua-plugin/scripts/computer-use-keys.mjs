/**
 * 键位与修饰键的输入侧规范化。
 *
 * 模型关于按键的先验大多来自 xdotool / X keysym 的写法（`control_l`、`prior`、
 * `Return`），而 broker 侧认的是另一套内部 token。这一层只做**输入侧**翻译：
 * 接受常见写法，输出内部 token。
 *
 * 它不改变跨平台的修饰键语义——macOS 用 cmd，Linux / Windows 用 ctrl，这条规则
 * 由 {@link normalizeKeyChord} 在遇到 `super*` 时按平台决定。
 */

/**
 * 内部 token → 它的各种同义写法。
 *
 * 用「一个规范名对多个拼法」而不是平铺别名表，是因为后者要手写两遍对应关系、
 * 漏一边就静默少一个别名。下面反查表的构建保证了每种拼法都指向唯一的规范名。
 */
const TOKEN_SPELLINGS = Object.freeze({
  return: ["return", "enter", "kp_enter"],
  ctrl: ["control_l", "control_r", "control", "ctrl"],
  // `meta_l` 是 macOS 的 Option 键，在 ZCode 的 token 集合里归到 alt。
  alt: ["alt_l", "alt_r", "meta_l", "alt"],
  shift: ["shift_l", "shift_r", "shift"],
  esc: ["escape", "esc"],
  pageup: ["prior"],
  pagedown: ["next"],
  ".": ["period"],
  ",": ["comma"],
  ">": ["greater"],
  "/": ["slash"],
  "-": ["minus"],
  "=": ["equal"],
});

/** 拼法（小写）→ 内部 token。 */
const CANONICAL_TOKEN = new Map();
for (const [token, spellings] of Object.entries(TOKEN_SPELLINGS)) {
  for (const spelling of spellings) CANONICAL_TOKEN.set(spelling, token);
}

/**
 * `super*` 是唯一需要按平台分叉的一组：它在 macOS 上是 cmd，Windows 上是 win，
 * 其余平台保持 super 交给 broker 解释。
 */
const SUPER_SPELLINGS = new Set(["super", "super_l", "super_r"]);

/**
 * 把一个和弦拆成 `+` 分隔的 token 并逐个规范化。
 *
 * @param {string} chord 例如 `"ctrl+alt+Return"` 或 `"super+s"`
 * @param {string} platform `process.platform`
 * @returns {string} 规范化后的和弦；空 token 会被丢弃（`"a++b"` → `"a+b"`）
 */
export function normalizeKeyChord(chord, platform) {
  return String(chord)
    .split("+")
    .map((segment) => {
      const original = segment.trim();
      const lowered = original.toLowerCase();
      if (SUPER_SPELLINGS.has(lowered)) {
        if (platform === "darwin") return "cmd";
        if (platform === "win32") return "win";
        return "super";
      }
      // 未登记的写法原样透传：按键名可能带大小写（`F5`）或是 broker 私有的，
      // 强行改写会比不过滤造成更大的破坏。
      return CANONICAL_TOKEN.get(lowered) ?? original;
    })
    .filter(Boolean)
    .join("+");
}
