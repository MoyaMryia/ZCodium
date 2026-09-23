/**
 * `@zcode/zcode-cua` 入口。
 *
 * 原生执行层复用 `trycua/cua` 的 `@trycua/cua-driver`（见
 * `.agents/specs/computer-use-runtime.md`）；本包只提供 ZCode 侧的
 * `ComputerUseRuntime` 适配器与协议常量。
 */
export {
  UNAVAILABLE_TEXT,
  assertCuaDriverClient,
  createComputerUseRuntime,
  createCuaDriverRuntime,
  createUnavailableRuntime,
  projectDriverError,
  projectToolResult,
} from "./runtime.js";
