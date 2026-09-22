import type { ZCodeUiError } from "@/lib/zcodeUiError.js";
import { resolveDiagnosticAttribution } from "@/lib/diagnostics/chatErrorAttribution.js";
import { recordUiDiagnostic } from "@/lib/diagnostics/recorder.js";

/** 从业务错误推断低基数分类，不复制错误原文、provider 身份或业务 ID。 */
export function recordChatError(params: { error: ZCodeUiError; displayMessage: string }): void {
  const attribution = resolveDiagnosticAttribution(params);
  recordUiDiagnostic({
    name: "ui_chat_error",
    group: "ui_error",
    value: 1,
    properties: {
      error_source: attribution.errorSource,
      failure_reason: attribution.failureReason,
    },
  });
}
