import type { Logger } from "@zcode/contracts";
import {
  createMemorySampleWriteGate,
  memoryUsageToSampleFields,
  zcodeProtocolNotifications,
  type MemorySample,
  type ZCodeProtocolNotification,
} from "@zcode/shared";
import {
  createZCodeProcessResourceSampler,
  type ZCodeProcessResourceSampler,
} from "../process-resource-sampler.js";
import type { ZCodeProtocolAgentServer } from "./server.js";

export function startProtocolMaintenance(
  server: Pick<
    ZCodeProtocolAgentServer,
    | "rebalanceResidentSessions"
    | "pruneSessionEventStores"
    | "pruneDetachedChildPublishers"
    | "collectMemoryDiagnostics"
  >,
  logger: Logger,
  send?: (message: ZCodeProtocolNotification) => void,
): ZCodeProcessResourceSampler | undefined {
  try {
    // 本地内存诊断日志：复用同一 60s 节拍，
    // 变化/心跳门控后才写一行，避免与消息流同频刷盘。
    const memoryDiagnosticsGate = createMemorySampleWriteGate();
    const sampler = createZCodeProcessResourceSampler({
      onSample: (sample, memoryUsage) => {
        try {
          send?.({ method: zcodeProtocolNotifications.processResourceSample, params: sample });
        } catch {
          // 本地 IPC 关闭不能阻断会话维护和本地日志。
        }
        // resident session TTL / 水位收敛借用资源采样节拍（60s）作兜底，不新增定时器；
        // sampler 对 onSample 已有异常兜底，单次 rebalance 失败不影响遥测上报。
        try {
          server.rebalanceResidentSessions();
        } catch {
          // 一项维护失败不能阻断其他清理与诊断。
        }
        try {
          // 同一节拍先做瞬态事件时间兜底淘汰，再采样，日志里的 eventRows 反映淘汰后的驻留量。
          server.pruneSessionEventStores();
          server.pruneDetachedChildPublishers();
        } catch {
          // 兜底淘汰失败不影响资源上报与诊断日志。
        }
        try {
          const memorySample: MemorySample = {
            role: "agent_node",
            ...memoryUsageToSampleFields(memoryUsage),
            counters: server.collectMemoryDiagnostics(),
          };
          const reason = memoryDiagnosticsGate.evaluate(memorySample, Date.now());
          if (reason) {
            const { role: _role, counters, ...memoryFields } = memorySample;
            logger.info("Process memory sample", {
              event: "zcode_protocol.process.memory_sample",
              reason,
              rssBytes: memoryFields.rssKb === undefined ? undefined : memoryFields.rssKb * 1024,
              heapUsedBytes:
                memoryFields.heapUsedKb === undefined ? undefined : memoryFields.heapUsedKb * 1024,
              heapTotalBytes:
                memoryFields.heapTotalKb === undefined
                  ? undefined
                  : memoryFields.heapTotalKb * 1024,
              externalBytes:
                memoryFields.externalKb === undefined ? undefined : memoryFields.externalKb * 1024,
              arrayBuffersBytes:
                memoryFields.arrayBuffersKb === undefined
                  ? undefined
                  : memoryFields.arrayBuffersKb * 1024,
              sessionCount: counters?.sessions,
              eventRowCount: counters?.eventRows,
              eventEvictedCount: counters?.eventEvicted,
              eventTransientRetainedCount: counters?.eventTransientRetained,
              publisherCount: counters?.["v4.publishers"],
              detachedLiveCount: counters?.["v4.detachedLive"],
              detachedTerminalCount: counters?.["v4.detachedTerminal"],
              rawSequenceStateCount: counters?.["v4.rawSeqStates"],
            });
          }
        } catch {
          // 诊断日志失败只丢当前样本，不影响资源上报与 rebalance。
        }
      },
    });
    sampler.start();
    return sampler;
  } catch {
    // 资源遥测是 best effort，初始化失败不能改变 Agent 启动结果。
    return undefined;
  }
}

export type ProtocolMaintenance = ZCodeProcessResourceSampler;
