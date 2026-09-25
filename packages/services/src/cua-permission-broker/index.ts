// Computer Use 的 services 内部 barrel。
//
// 闭源 `ZCode Computer Use.app`（macOS）的整条 broker 已拆除 —— 那 51 个文件的实现从未进入
// 本仓库，`@zcode/zcode-cua/broker*` 一直是 stub。权限契约改由
// `@zcode/zcode-cua/permissions`（cua-driver `check_permissions`）提供；
// socket 铸造 / 启动 rendezvous / Helper host 传输类型等 Windows 仍在用的符号在
// `@zcode/zcode-cua/helper-transport`。
//
// 这里只保留 services 自己需要的东西：权限 descriptor + Windows Helper host。

/** @deprecated 默认 CUA 装配不再使用，仅为旧注入方保留兼容导出。 */
export {
  CuaAgentAdmissionGate,
  type CuaAgentSpawnAdmissionContext,
} from "./cuaAgentAdmissionGate.js";

// Services 自己拥有 permission-service descriptor 值，并复用 producer 的权限契约。
export {
  ICuaPermissionService,
  isCuaPermissionStatusAvailable,
  shouldRunCuaScreenCaptureProbe,
} from "./cuaPermissionService.js";
export type {
  CuaPermissionState,
  CuaPermissionStatus,
  CuaPermissionStatusUnavailable,
  CuaPermissionStatusResult,
  CuaPermissionStatusQueryOptions,
  CuaPermissionRestartResult,
  CuaPermissionRestartOptions,
} from "./cuaPermissionService.js";

export { WindowsCuaHelperHost } from "./windowsCuaDevHelperHost.js";
export type {
  ManagedCuaProductHelperHost,
  WindowsCuaChild,
  WindowsCuaChildProcessAdapter,
  WindowsCuaHelperHostOptions,
} from "./windowsCuaDevHelperHost.js";
