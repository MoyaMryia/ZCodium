import { SessionEventType, type SessionEvent, type TurnCompletePayload } from "@zcode/contracts";
export function streamingParentToolCallId(payload: Record<string, unknown>): string | undefined {
  const meta = recordValue(payload._meta);
  const zcode = recordValue(meta.zcode);
  return (
    optionalString(payload.parentToolCallId) ??
    optionalString(payload.parentToolUseId) ??
    optionalString(meta.parentToolCallId) ??
    optionalString(meta.parentToolUseId) ??
    optionalString(zcode.parentToolCallId) ??
    optionalString(zcode.parentToolUseId)
  );
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function turnTerminalState(event: SessionEvent): "failed" | "cancelled" | "completed" {
  if (event.type === SessionEventType.TurnError) return "failed";
  const resultType = (event.payload as TurnCompletePayload).resultType;
  return resultType.startsWith("error_")
    ? "failed"
    : resultType === "cancelled"
      ? "cancelled"
      : "completed";
}
