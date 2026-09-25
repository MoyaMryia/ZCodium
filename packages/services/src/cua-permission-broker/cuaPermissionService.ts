// Computer Use 权限服务 — services-side descriptor registration。
//
// 契约与实现都在 @zcode/zcode-cua/permissions（cua-driver 的 check_permissions 后端），
// 取代了原先闭源 Helper 的 permission_status broker 回报。descriptor 注册本身留在 services：
// 它依赖 services 的 createServiceDescriptor 与 @zcode/shared 的 ServiceChannels，
// 属于 host 控制面，不该反向塞进 producer。
//
// 因此 services 内部调用方（node.ts / accessor.ts / services/index.ts）与 UI 消费者
// （经 @zcode/services 根导出）继续从这条路径 import `ICuaPermissionService`。

import { ServiceChannels } from "@zcode/shared";

import { createServiceDescriptor } from "../descriptors.js";

// 类型层：type-only import，编译期擦除；Vite 不会为这些解析 @zcode/zcode-cua。
import type {
  CuaPermissionState,
  CuaPermissionStatus,
  CuaPermissionStatusUnavailable,
  CuaPermissionStatusResult,
  CuaPermissionStatusQueryOptions,
  CuaPermissionRestartResult,
  CuaPermissionRestartOptions,
  ICuaPermissionService as CuaDriverICuaPermissionService,
} from "@zcode/zcode-cua/permissions";

// Re-export types for consumers.
export type {
  CuaPermissionState,
  CuaPermissionStatus,
  CuaPermissionStatusUnavailable,
  CuaPermissionStatusResult,
  CuaPermissionStatusQueryOptions,
  CuaPermissionRestartResult,
  CuaPermissionRestartOptions,
};

// 只从 producer 的纯 permissions subpath 复用值谓词。这里不能再复制实现，
// 否则“省略 options 是否主动抓屏”这种隐私契约会再次漂移。
export {
  isCuaPermissionStatusAvailable,
  shouldRunCuaScreenCaptureProbe,
} from "@zcode/zcode-cua/permissions";

export interface ICuaPermissionService extends CuaDriverICuaPermissionService {}

export const ICuaPermissionService = createServiceDescriptor<CuaDriverICuaPermissionService>(
  ServiceChannels.CuaPermission,
);
