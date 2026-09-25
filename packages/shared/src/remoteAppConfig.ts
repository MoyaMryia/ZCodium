function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null;
}

export function getForceUpdateMinimalVersionFromConfig(config: unknown): string | undefined {
  if (!isRecord(config)) {
    return undefined;
  }

  const forceUpdate = config.forceUpdate;
  if (!isRecord(forceUpdate)) {
    return undefined;
  }

  const minimalVersion = forceUpdate.minimalVersion;
  return typeof minimalVersion === "string" && minimalVersion.trim() !== ""
    ? minimalVersion.trim()
    : undefined;
}
