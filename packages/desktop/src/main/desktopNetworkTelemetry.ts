import type { NetworkObservation } from "@zcode/rpc";
import {
  flushInterfaceNetworkStats,
  recordNetworkObservation,
  resetNetworkTelemetryAggregator,
} from "./networkTelemetryAggregator.js";
import { recordDesktopDiagnostic } from "./localDiagnosticSink.js";
let timer: ReturnType<typeof setInterval> | undefined;
export function ingestHostNetworkObservations(observations: NetworkObservation[]): void {
  for (const observation of observations) recordNetworkObservation(observation);
}
export function flushNetworkDiagnostics(): void {
  for (const stats of flushInterfaceNetworkStats())
    recordDesktopDiagnostic({
      version: 1,
      name: "network.request",
      component: "host",
      transport: stats.transport,
      errorCategory:
        stats.primaryErrorKind === undefined
          ? undefined
          : stats.primaryErrorKind === "timeout"
            ? "timeout"
            : stats.primaryErrorKind === "server_error"
              ? "provider"
              : stats.primaryErrorKind === "client_error"
                ? "validation"
                : "network",
      metrics: {
        durationMs: stats.duration.mean,
        p95Ms: stats.duration.p95,
        count: stats.requestTotal,
        successCount: stats.successCount,
        errorCount: stats.failCount,
        retryCount: stats.retryCount,
        dnsMs: stats.dns.mean,
        tcpMs: stats.tcp.mean,
        tlsMs: stats.tls.mean,
        ttfbMs: stats.ttfb.mean,
        downloadMs: stats.download.mean,
      },
    });
}
export function registerDesktopNetworkTelemetry(): void {
  stopDesktopNetworkTelemetry();
  resetNetworkTelemetryAggregator();
  timer = setInterval(flushNetworkDiagnostics, 300_000);
  timer.unref();
}
export function stopDesktopNetworkTelemetry(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  flushNetworkDiagnostics();
}
