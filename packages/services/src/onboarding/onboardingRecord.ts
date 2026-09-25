import type {
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
} from "@zcode/shared";
import { ServiceChannels } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IOnboardingRecordService {
  /** 保存本机最近一次引导答案，不关联账号。 */
  appendRecord(entry: OnboardingRecordEntryInput): Promise<void>;
  /** 手动打开引导时预填最近答案；无记录返回 null。 */
  getLatestEntry(): Promise<OnboardingRecordEntry | null>;
  /** 手动修改偏好后同步本地记录；运行时事实仍属于 Setting。 */
  updateRecordPreferences(
    patch: Partial<
      Pick<OnboardingRecordEntryInput, "memoryEnabled" | "proactiveSuggestionsEnabled">
    >,
  ): Promise<void>;
  /** 读取不含身份字段的本地记录；文件不存在返回 null。 */
  getRecords(): Promise<OnboardingRecordFile | null>;
  /** 删除记录文件（调试用）。 */
  clearRecords(): Promise<void>;
}

export const IOnboardingRecordService = createServiceDescriptor<IOnboardingRecordService>(
  ServiceChannels.OnboardingRecord,
);

export type { OnboardingRecordEntry, OnboardingRecordEntryInput, OnboardingRecordFile };
