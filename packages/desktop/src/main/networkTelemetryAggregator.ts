import { computeAggregateStats } from "./resourceMetricsStats.js";
import type { NetworkObservation, NetworkTransportKind } from "@zcode/rpc";
const ERROR_KINDS = [
  "timeout",
  "dns_failure",
  "connection_reset",
  "proxy_error",
  "tls_error",
  "server_error",
  "client_error",
  "other",
] as const;
export type NetworkErrorKind = (typeof ERROR_KINDS)[number];
interface Bucket {
  transport: NetworkTransportKind;
  durations: number[];
  dns: number[];
  tcp: number[];
  tls: number[];
  ttfb: number[];
  download: number[];
  successCount: number;
  failCount: number;
  retryCount: number;
  errorCounts: Map<NetworkErrorKind, number>;
}
const buckets = new Map<NetworkTransportKind, Bucket>();
const push = (values: number[], value: number | undefined) => {
  if (value !== undefined && Number.isFinite(value) && value >= 0) {
    values.push(value);
    if (values.length > 300) values.shift();
  }
};
/** 仅保留固定协议类别；interface 可能包含任意服务地址，不能成为诊断维度。 */
export function recordNetworkObservation(observation: NetworkObservation): void {
  if (!["rpc", "http", "websocket"].includes(observation.transport)) return;
  let bucket = buckets.get(observation.transport);
  if (!bucket) {
    bucket = {
      transport: observation.transport,
      durations: [],
      dns: [],
      tcp: [],
      tls: [],
      ttfb: [],
      download: [],
      successCount: 0,
      failCount: 0,
      retryCount: 0,
      errorCounts: new Map(),
    };
    buckets.set(observation.transport, bucket);
  }
  push(bucket.durations, observation.durationMs);
  for (const phase of ["dns", "tcp", "tls", "ttfb", "download"] as const)
    push(bucket[phase], observation[`${phase}Ms`]);
  if (observation.ok) bucket.successCount++;
  else {
    bucket.failCount++;
    const kind = ERROR_KINDS.includes(observation.errorKind as NetworkErrorKind)
      ? (observation.errorKind as NetworkErrorKind)
      : "other";
    bucket.errorCounts.set(kind, (bucket.errorCounts.get(kind) ?? 0) + 1);
  }
  if (observation.attempt && Number.isFinite(observation.attempt))
    bucket.retryCount += Math.max(0, observation.attempt - 1);
}
export function flushInterfaceNetworkStats() {
  const result = [...buckets.values()].map((bucket) => ({
    transport: bucket.transport,
    requestTotal: bucket.successCount + bucket.failCount,
    successCount: bucket.successCount,
    failCount: bucket.failCount,
    retryCount: bucket.retryCount,
    primaryErrorKind: [...bucket.errorCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
    duration: computeAggregateStats(bucket.durations),
    dns: computeAggregateStats(bucket.dns),
    tcp: computeAggregateStats(bucket.tcp),
    tls: computeAggregateStats(bucket.tls),
    ttfb: computeAggregateStats(bucket.ttfb),
    download: computeAggregateStats(bucket.download),
  }));
  buckets.clear();
  return result;
}
export function resetNetworkTelemetryAggregator(): void {
  buckets.clear();
}
