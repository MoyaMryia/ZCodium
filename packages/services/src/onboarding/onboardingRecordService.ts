import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { onboardingRecordFileSchema } from "@zcode/shared";
import type {
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
} from "@zcode/shared";
import { atomicWriteText } from "../fs/atomicFileUtils.js";
import { getAppConfigDir } from "../paths.js";
import { createServiceLogger } from "../logger/serviceLogger.js";
import type { IOnboardingRecordService } from "./onboardingRecord.js";

const logger = createServiceLogger("onboardingRecordService");

function getRecordFile(): string {
  // 记录是设备级数据，必须跟随 dataBaseDir（用户自定义数据目录时落在其 .zcodium/v2 下，
  // 统一位于该目录），不能学 setting.json 固定写 home——setting.json 留在 home
  // 只是启动引导需要固定位置读取 dataBaseDir，不代表其他设备数据的落点。
  return join(getAppConfigDir(), "onboarding-record.json");
}

/**
 * 读取记录文件；文件不存在返回 null，内容损坏（手改/写坏）时同样返回 null 并 warn——
 * 损坏文件等价于"从未记录"，用户手动完成引导后在下次 append 时重建。
 */
async function readRecordFile(filePath: string): Promise<OnboardingRecordFile | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return null;
    logger.warn(undefined, "read onboarding record failed:", err);
    return null;
  }
  try {
    return onboardingRecordFileSchema.parse(JSON.parse(raw));
  } catch (cause) {
    logger.warn(undefined, "invalid onboarding record json, treating as missing. error:", cause);
    return null;
  }
}

function latestEntry(file: OnboardingRecordFile | null): OnboardingRecordEntry | null {
  return (file?.entries ?? []).reduce<OnboardingRecordEntry | null>((latest, entry) => {
    if (!latest) return entry;
    const currentTime = Date.parse(entry.completedAt);
    const latestTime = Date.parse(latest.completedAt);
    // 旧文件按账号覆盖原位置，数组末项不一定最近；无效时间仅按原有顺序兼容。
    return Number.isFinite(currentTime) && Number.isFinite(latestTime) && currentTime < latestTime
      ? latest
      : entry;
  }, null);
}

export function createOnboardingRecordService(): IOnboardingRecordService {
  let writeQueue: Promise<unknown> = Promise.resolve();
  const enqueueWrite = <T>(task: () => Promise<T>): Promise<T> => {
    const queued = writeQueue.then(task, task) as Promise<T>;
    writeQueue = queued.catch(() => {});
    return queued;
  };
  const readCurrent = async () => {
    // 读取必须等待已接受写入，避免关闭引导后立即重开时预填旧偏好。
    await writeQueue;
    return readRecordFile(getRecordFile());
  };
  const writeEntry = async (entry: OnboardingRecordEntryInput) => {
    const filePath = getRecordFile();
    // schema 剥离旧身份/上传字段；写回只保留本机最近答案，不继续维护账号档案。
    const file = onboardingRecordFileSchema.parse({ version: 1, entries: [entry] });
    await mkdir(join(filePath, ".."), { recursive: true });
    await atomicWriteText(filePath, JSON.stringify(file, null, 2));
  };

  return {
    appendRecord(entry) {
      const validated = onboardingRecordFileSchema.shape.entries.element.parse(entry);
      return enqueueWrite(() => writeEntry(validated));
    },
    async getLatestEntry() {
      return latestEntry(await readCurrent());
    },
    updateRecordPreferences(patch) {
      // 在入队时冻结补丁，防止调用方在排队期间修改已接受的偏好。
      const accepted = onboardingRecordFileSchema.shape.entries.element
        .pick({ memoryEnabled: true, proactiveSuggestionsEnabled: true })
        .partial()
        .parse(patch);
      return enqueueWrite(async () => {
        const latest = latestEntry(await readRecordFile(getRecordFile()));
        if (latest) await writeEntry({ ...latest, ...accepted });
      });
    },
    getRecords: readCurrent,
    clearRecords() {
      return enqueueWrite(() => rm(getRecordFile(), { force: true }));
    },
  };
}
