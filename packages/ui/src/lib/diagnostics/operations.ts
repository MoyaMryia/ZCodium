import { recordUiDiagnostic } from "@/lib/diagnostics/recorder.js";

/** 技术边界计时，不记录命令类型、偏好字段、参数或返回数据。 */
export async function measureOperation<T>(
  stage: "command" | "settings",
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    recordUiDiagnostic({
      name: "ui_operation",
      group: "ui_perf",
      value: performance.now() - startedAt,
      properties: { stage, status: "success" },
    });
    return result;
  } catch (error) {
    recordUiDiagnostic({
      name: "ui_operation",
      group: "ui_perf",
      value: performance.now() - startedAt,
      properties: { stage, status: "failed" },
    });
    // 保留原异常身份与调用方恢复路径；诊断失败由 sink 隔离。
    throw error;
  }
}
