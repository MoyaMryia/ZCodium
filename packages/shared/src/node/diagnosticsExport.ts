import { parseDiagnosticRecord, type DiagnosticRecord } from "../diagnostics.js";

export interface DiagnosticsExporter {
  readonly enabled: boolean;
  record(record: unknown): boolean;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}
export interface DiagnosticsExporterOptions {
  env?: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}
const disabled: DiagnosticsExporter = {
  enabled: false,
  record: () => false,
  flush: async () => {},
  shutdown: async () => {},
};

function configuration(
  env: Record<string, string | undefined>,
): { endpoint: URL; headers: Headers } | undefined {
  if (env.ZCODE_DIAGNOSTICS_EXPORT_ENABLED !== "1") return;
  const raw = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!raw?.trim()) return;
  try {
    const endpoint = new URL(raw);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      return;
    if (!env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT)
      endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/v1/logs`;
    const headers = new Headers();
    for (const pair of (
      env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ||
      env.OTEL_EXPORTER_OTLP_HEADERS ||
      ""
    ).split(",")) {
      if (!pair.trim()) continue;
      const index = pair.indexOf("=");
      if (index < 1) return;
      const key = pair.slice(0, index).trim();
      if (/^(host|content-length|transfer-encoding|connection)$/i.test(key)) return;
      headers.set(key, decodeURIComponent(pair.slice(index + 1).trim()));
    }
    headers.set("content-type", "application/json");
    return { endpoint, headers };
  } catch {
    return;
  }
}

function toLogRecord(record: DiagnosticRecord, timestamp: number) {
  const observed = String(BigInt(timestamp) * 1_000_000n);
  const attributes = Object.entries(record).flatMap(([key, value]) => {
    if (["metrics", "traceId", "spanId", "name", "version"].includes(key) || value === undefined)
      return [];
    return [
      {
        key: `zcodium.${key}`,
        value: typeof value === "number" ? { doubleValue: value } : { stringValue: String(value) },
      },
    ];
  });
  for (const [key, value] of Object.entries(record.metrics)) {
    if (value !== undefined)
      attributes.push({ key: `zcodium.${key}`, value: { doubleValue: value } });
  }
  return {
    ...(record.traceId ? { traceId: record.traceId } : {}),
    ...(record.traceId && record.spanId ? { spanId: record.spanId } : {}),
    timeUnixNano:
      record.timestampUnixMs === undefined
        ? observed
        : String(BigInt(record.timestampUnixMs) * 1_000_000n),
    observedTimeUnixNano: observed,
    body: { stringValue: record.name },
    severityNumber: record.status === "error" || record.status === "timeout" ? 17 : 9,
    attributes,
  };
}

/** 标准 OTLP/HTTP JSON；不探测设备/账号、不自动注入资源、不读取响应正文。 */
export function createDiagnosticsExporter(
  options: DiagnosticsExporterOptions = {},
): DiagnosticsExporter {
  const config = configuration(options.env ?? process.env);
  // 必须先判定显式配置：默认路径不分配队列、定时器，也不初始化网络客户端。
  if (!config) return disabled;
  const send = options.fetch ?? globalThis.fetch;
  let closed = false;
  let failureReported = false;
  const reportFailure = (statusCode: number, errorCount: number) => {
    if (failureReported) return;
    failureReported = true;
    try {
      console.warn("Diagnostic export failed", {
        errorCategory: "network",
        statusCode,
        errorCount,
      });
    } catch {
      /* Closed diagnostic console. */
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Array<ReturnType<typeof toLogRecord>> = [];
  let draining: Promise<void> | undefined;
  let shutdownPromise: Promise<void> | undefined;
  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): Promise<void> => {
    cancelTimer();
    if (draining) return draining.then(flush);
    if (pending.length === 0) return Promise.resolve();
    // 唯一pump拥有队列。并发flush/退出都等待同一个drain，不能只等前一批请求。
    draining = (async () => {
      while (pending.length > 0) {
        const logRecords = pending;
        pending = [];
        try {
          const response = await send(config.endpoint, {
            method: "POST",
            headers: config.headers,
            redirect: "error",
            signal: AbortSignal.timeout(2500),
            body: JSON.stringify({
              resourceLogs: [
                {
                  resource: {
                    attributes: [{ key: "service.name", value: { stringValue: "ZCodium" } }],
                  },
                  scopeLogs: [{ scope: { name: "zcodium.diagnostics", version: "1" }, logRecords }],
                },
              ],
            }),
          });
          if (response.ok) failureReported = false;
          else reportFailure(response.status, logRecords.length);
          await response.body?.cancel();
        } catch {
          reportFailure(0, logRecords.length);
        }
      }
    })().finally(() => {
      draining = undefined;
    });
    return draining;
  };
  return {
    enabled: true,
    record(input) {
      if (closed || pending.length >= 256) return false;
      const parsed = parseDiagnosticRecord(input);
      if (!parsed) return false;
      pending.push(toLogRecord(parsed, Date.now()));
      if (!timer) {
        timer = setTimeout(() => {
          void flush();
        }, 1000);
        timer.unref();
      }
      return true;
    },
    flush,
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      closed = true;
      cancelTimer();
      shutdownPromise = flush();
      return shutdownPromise;
    },
  };
}
