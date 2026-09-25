// ============================================================
// HTTP Client Port - network I/O boundary
// ============================================================

import type { ExecutionContext, TraceContext } from "../tracing/tracer.js";

export type HttpClientMethod = "GET" | "HEAD" | "POST";
export type HttpClientRedirectPolicy = "manual" | "follow";
export type HttpClientEgressPolicy = "public";

export type HttpClientErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "timeout"
  | "cancelled"
  | "too_large"
  | "egress_blocked"
  | "network_error"
  | "proxy_error";

export interface HttpClientErrorDetails {
  code: HttpClientErrorCode;
  url?: string;
  status?: number;
  message: string;
  cause?: unknown;
}

export class HttpClientPortError extends Error {
  readonly code: HttpClientErrorCode;
  readonly url?: string;
  readonly status?: number;
  override readonly cause?: unknown;

  constructor(details: HttpClientErrorDetails) {
    super(details.message);
    this.name = "HttpClientPortError";
    this.code = details.code;
    this.url = details.url;
    this.status = details.status;
    this.cause = details.cause;
  }
}

export function createHttpClientError(details: HttpClientErrorDetails): HttpClientPortError {
  return new HttpClientPortError(details);
}

export function isHttpClientPortError(error: unknown): error is HttpClientPortError {
  return error instanceof HttpClientPortError;
}

export interface HttpClientRequest {
  url: string;
  method?: HttpClientMethod;
  headers?: Record<string, string>;
  body?: Uint8Array;
  timeoutMs?: number;
  maxResponseBytes?: number;
  redirect?: HttpClientRedirectPolicy;
  egressPolicy?: HttpClientEgressPolicy;
  /** 仅用于本地执行关联，HTTP adapter 不得自动将其转换为出站请求头。 */
  trace?: TraceContext;
}

export interface HttpClientEgressInfo {
  proxied: boolean;
  proxySource?: string;
  proxyHost?: string;
  noProxyMatched?: boolean;
  customCa?: boolean;
}

export interface HttpClientResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Uint8Array;
  bytes: number;
  durationMs: number;
  egress?: HttpClientEgressInfo;
}

export interface HttpClientRunOptions {
  signal?: AbortSignal;
  context?: ExecutionContext;
}

export interface HttpClientPort {
  request(request: HttpClientRequest, options?: HttpClientRunOptions): Promise<HttpClientResponse>;
}
