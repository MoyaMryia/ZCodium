const REDACTED_METADATA_USER_ID = "[REDACTED]";

export function redactAnthropicRequestMetadata(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      const redacted = redactAnthropicRequestMetadata(parsed);
      return redacted === parsed ? value : JSON.stringify(redacted);
    } catch {
      return value;
    }
  }
  if (!isRecord(value)) {
    return value;
  }

  let result = value;
  const wireMetadata = isRecord(value.metadata) ? value.metadata : undefined;
  if (wireMetadata && wireMetadata.user_id !== undefined) {
    result = {
      ...result,
      metadata: {
        ...wireMetadata,
        user_id: REDACTED_METADATA_USER_ID,
      },
    };
  }

  const providerOptions = isRecord(value.providerOptions) ? value.providerOptions : undefined;
  const anthropicOptions = isRecord(providerOptions?.anthropic)
    ? providerOptions.anthropic
    : undefined;
  const providerMetadata = isRecord(anthropicOptions?.metadata)
    ? anthropicOptions.metadata
    : undefined;
  if (providerOptions && anthropicOptions && providerMetadata?.userId !== undefined) {
    result = {
      ...result,
      providerOptions: {
        ...providerOptions,
        anthropic: {
          ...anthropicOptions,
          metadata: {
            ...providerMetadata,
            userId: REDACTED_METADATA_USER_ID,
          },
        },
      },
    };
  }

  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
