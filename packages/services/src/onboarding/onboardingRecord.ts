import type {
  OnboardingRecordEntry,
  OnboardingRecordEntryInput,
  OnboardingRecordFile,
} from "@zcode/shared";
import { ServiceChannels, type AppSettings } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

/** 登录态变化时按 record 回填 settings 的字段范围（settings 仍是运行时唯一事实源）。 */
export interface OnboardingSettingsSyncPatch {
  onboardingOccupation?: AppSettingsPatchOccupation;
  proactiveSuggestionsEnabled?: boolean;
  memoryEnabled?: boolean;
}

type AppSettingsPatchOccupation = NonNullable<AppSettings["onboardingOccupation"]>;

export interface IOnboardingRecordService {
  /**
   * 保存本地引导完成记录；
   * userId 由服务内部按当前登录态补全，调用方不传。
   */
  appendRecord(entry: OnboardingRecordEntryInput): Promise<void>;
  /** 触发判定：当前用户（登录→userId；apikey/未登录→null）没有对应记录或文件不存在时为 true。 */
  shouldOnboard(): Promise<boolean>;
  /**
   * 登录认领：当前 userId 没有条目而存在匿名（null）条目时，把 null 条目移交给该 userId
   * （改写而非复制）。同一人"未登录答一次→登录"
   * 不再被当成新用户重复引导；匿名态失去记录后再次触发引导属预期。
   * 未登录（userId=null）或已有条目时为幂等空操作。
   */
  claimAnonymousRecord(): Promise<void>;
  /** 当前用户最近一条作答（引导再次打开时预填用）；无记录返回 null。 */
  getLatestEntry(): Promise<OnboardingRecordEntry | null>;
  /**
   * 把当前用户在 record 里最近一条作答同步回 settings（换账号恢复该用户的职业/偏好，
   * 推荐区内容随之切换）。跳过页记 null 的字段按保守默认回填（职业 other、偏好关），
   * 与引导跳过行为一致；用户没有记录时不改 settings。
   */
  syncSettingsFromRecord(): Promise<OnboardingSettingsSyncPatch | null>;
  /**
   * 用户手动修改偏好后反向回写 record（record 保持"该用户最新偏好"，
   * 与 settings 手动入口一致，换号同步不会复活已关闭的开关）。当前用户无条目时忽略。
   */
  updateRecordPreferences(
    patch: Partial<
      Pick<OnboardingRecordEntryInput, "memoryEnabled" | "proactiveSuggestionsEnabled">
    >,
  ): Promise<void>;
  /** 读取整份本地记录文件；文件不存在返回 null。 */
  getRecords(): Promise<OnboardingRecordFile | null>;
  /** 删除记录文件（调试用）。 */
  clearRecords(): Promise<void>;
}

/** 工厂入参：userId 解析注入（正式装配用 oauthCredentialRepo，测试用桩）。 */
export interface CreateOnboardingRecordServiceOptions {
  loadUserId: () => Promise<string | null>;
}

export type OnboardingRecordServiceFactory = (
  options: CreateOnboardingRecordServiceOptions,
) => IOnboardingRecordService;

export const IOnboardingRecordService = createServiceDescriptor<IOnboardingRecordService>(
  ServiceChannels.OnboardingRecord,
);

export type { OnboardingRecordEntry, OnboardingRecordEntryInput, OnboardingRecordFile };
