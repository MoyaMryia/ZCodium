import { createHash } from "node:crypto";

function assertValidUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new TypeError("Conversation share JSON contains invalid Unicode");
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeError("Conversation share JSON contains invalid Unicode");
    }
  }
}

function canonicalizeValue(value: unknown): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new TypeError("Conversation share JSON numbers must be finite");
      }
      return JSON.stringify(value);
    }
    case "string":
      assertValidUnicode(value);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalizeValue(entry)).join(",")}]`;
      }

      const record = value as Record<string, unknown>;
      const entries = Object.keys(record)
        .sort()
        .map((key) => {
          assertValidUnicode(key);
          const entry = record[key];
          if (entry === undefined) {
            throw new TypeError("Conversation share JSON cannot contain undefined values");
          }
          return `${JSON.stringify(key)}:${canonicalizeValue(entry)}`;
        });
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`Conversation share JSON cannot contain ${typeof value}`);
  }
}

function canonicalizeConversationShareJson(value: unknown): string {
  return canonicalizeValue(value);
}

export function sha256ConversationShareJson(value: unknown): string {
  return createHash("sha256")
    .update(canonicalizeConversationShareJson(value), "utf8")
    .digest("hex");
}
