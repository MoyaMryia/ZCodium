const UNSUPPORTED_AUTH_MESSAGE =
  "Unsupported MCP auth configuration. Remove auth/official and configure headers or oauth.";

/** 旧专用鉴权不能被静默忽略，否则带身份要求的配置会变成匿名连接。 */
export function getUnsupportedMcpAuthError(config: object): string | undefined {
  const fields = config as Record<string, unknown>;
  return fields.auth !== undefined || fields.official !== undefined
    ? UNSUPPORTED_AUTH_MESSAGE
    : undefined;
}
