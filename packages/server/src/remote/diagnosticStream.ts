import { StringDecoder } from "node:string_decoder";
import { safeLogArgs } from "@zcode/shared";

/** 远端日志只接受有界安全 envelope；stderr 原文可能含路径/凭据，不能直接转存。 */
export function createRemoteDiagnosticConsumer(emit: (args: unknown[]) => void) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  let dropping = false;
  return (chunk: Uint8Array): void => {
    const text = decoder.write(Buffer.from(chunk));
    for (const part of text.split(/(?<=\n)/)) {
      const ended = part.endsWith("\n");
      if (!dropping) {
        if (pending.length + part.length > 64 * 1024) {
          pending = "";
          dropping = true;
        } else pending += part;
      }
      if (!ended) continue;
      if (!dropping && pending.trim()) {
        try {
          const value: unknown = JSON.parse(pending);
          if (
            value &&
            typeof value === "object" &&
            "kind" in value &&
            value.kind === "zcodium.diagnostic" &&
            "args" in value &&
            Array.isArray(value.args)
          )
            emit(safeLogArgs(value.args));
        } catch {
          // 旧版本未使用安全envelope，只保留代码静态消息，不保存原stderr。
          emit(safeLogArgs([pending.trim()]));
        }
      }
      pending = "";
      dropping = false;
    }
  };
}
