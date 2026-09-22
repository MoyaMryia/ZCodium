import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { createUuid } from "@zcode/shared";
import { getAppConfigDir } from "@zcode/services/node";

interface EnsureDesktopDeviceMidSyncOptions {
  /** state 文件所在目录，默认 getAppConfigDir()（即 ~/.zcode/v2）。仅测试注入 */
  configDir?: string;
  /** UUID 生成器，默认 createUuid。仅测试注入 */
  createId?: () => string;
}

/**
 * 在窗口创建前读取业务请求使用的持久设备身份。
 * 已存在合法值时不写盘；缺失时原子写回并保留其它状态字段。
 * 文件名保留以兼容现有业务身份，读写失败时返回进程内生成的 UUID。
 */
export function ensureDesktopDeviceMidSync(options?: EnsureDesktopDeviceMidSyncOptions): string {
  const createId = options?.createId ?? createUuid;
  try {
    const configDir = options?.configDir ?? getAppConfigDir();
    const stateFile = join(configDir, "telemetry-state.json");

    const state = readDeviceStateSync(stateFile);
    if (typeof state.deviceMid === "string" && state.deviceMid) {
      return state.deviceMid;
    }

    const deviceMid = createId();
    state.deviceMid = deviceMid;
    writeDeviceStateSync(stateFile, state);
    return deviceMid;
  } catch {
    // fs / JSON 异常兜底：保证一定有返回值，窗口创建不阻塞
    return createId();
  }
}

function readDeviceStateSync(stateFile: string): Record<string, unknown> {
  try {
    const raw = readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeDeviceStateSync(stateFile: string, state: Record<string, unknown>): void {
  const dir = dirname(stateFile);
  mkdirSync(dir, { recursive: true });
  const tempFile = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(tempFile, JSON.stringify(state, null, 2), "utf-8");
  renameSync(tempFile, stateFile);
}
