/**
 * Computer Use 工具名判定。渲染层用它区分 CUA 工具调用与普通工具调用。
 *
 * 曾经的「Helper 授权返回恢复 / 重启 Helper」机制随闭源 Helper 一起移除：
 * cua-driver 无常驻 Helper，授权改由平台能力 requestCuaPermissions /
 * openCuaPermissionSystemSettings 直接向系统申请。
 */

const ZCODE_CUA_TOOL_NAMES = new Set([
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

export function isZCodeCuaToolName(value: string | null | undefined): boolean {
  return typeof value === "string" && ZCODE_CUA_TOOL_NAMES.has(value);
}
