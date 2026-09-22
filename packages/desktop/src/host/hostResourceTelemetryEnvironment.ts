import { buildRemoteEnvironmentKey, type RemoteTarget } from "@zcode/shared";
/** 只用于内部环境路由与跨 Host 去重，不写入诊断记录或导出，不派生身份哈希。 */
export function resolveResourceTelemetryEnvironmentKey(target: RemoteTarget): string {
  return buildRemoteEnvironmentKey(target);
}
