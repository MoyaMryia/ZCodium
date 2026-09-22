import { useEffect, useRef, useState } from "react";
import type { AppSettings } from "@zcode/shared";
import type { useOnboardingRecordService } from "@/hooks/useOnboardingRecordService.js";
import { logger } from "@/logger.js";

/**
 * 是否在启动时自动触发“选择你是什么用户”开屏引导。默认禁用（产品决策，见
 * .agents/specs/first-run-login-and-onboarding.md）：首次启动直接进入主界面。
 * 手动打开（设置页、快捷键 openOnboarding）只读 store 的 newUserOnboardingOpen，
 * 不依赖该判定，因此不受此开关影响。
 */
function shouldAutoTriggerOnboarding(): boolean {
  return false;
}

/**
 * 引导触发判定：当前用户在本地记录里没有条目时
 * needsOnboarding=true。settings 回填（换号恢复偏好）只在 userId 运行时变化后发生；
 * 手动修改由各入口回写 record（updateRecordPreferences），record 始终等于该用户最新偏好。
 *
 * 返回 [needsOnboarding, markOnboarded]：null 表示异步判定中；markOnboarded 在引导
 * 保存成功后把判定置 false（记录已落盘，本次会话不再触发）。
 */
export function useOnboardingTrigger(options: {
  onboardingRecord: ReturnType<typeof useOnboardingRecordService>;
  userId: string | null;
  hasStoredOccupation: boolean;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}): [boolean | null, () => void] {
  const { onboardingRecord, userId, hasStoredOccupation, update } = options;
  // null 表示异步判定中（触发判定改为按本地记录）。
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  // 记录上一次判定时的 userId，回填只在身份实际变化后发生（见下方回填条件）。
  const lastSyncedUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // 开屏引导默认关闭：启动时不判定、不认领匿名记录、不做换账号回填，直接进主界面。
    // 手动打开的预填走 getLatestEntry，保存走 appendRecord，均不依赖这里的判定。
    if (!shouldAutoTriggerOnboarding()) {
      setNeedsOnboarding(false);
      return;
    }
    let cancelled = false;
    const fallback = () => !hasStoredOccupation;
    // 服务不可用（旧测试 double / 未注册的 host）时退回旧 settings 判定，行为不回退。
    if (!onboardingRecord) {
      setNeedsOnboarding(fallback());
      return;
    }
    // shouldOnboard 走 RPC，host 未带上 onboarding-record channel 时调用会挂起，
    // 之前判定期间渲染 null 会把整个主界面拦成永久黑屏。加超时兜底退回 settings 判定，
    // 保证任何情况下主界面最多等 3 秒。
    const timeout = setTimeout(() => {
      if (!cancelled) {
        logger.warn("[occupation-onboarding] shouldOnboard 超时，退回 settings 判定");
        setNeedsOnboarding(fallback());
      }
    }, 3000);
    // 登录认领先行：未登录时答的引导（null 条目）移交给当前登录用户，同一人不重复引导。
    // 必须 await 完成后再判定，否则 shouldOnboard 读到认领前的文件会误判需要引导。
    onboardingRecord
      .claimAnonymousRecord()
      .catch((cause: unknown) => {
        logger.warn("[occupation-onboarding] 认领匿名引导记录失败", { error: String(cause) });
      })
      .then(() => onboardingRecord.shouldOnboard())
      .then(
        (result) => {
          if (!cancelled) setNeedsOnboarding(result);
          // 换账号恢复该用户偏好：settings 不分用户，A 答完后 B 触发引导会把 settings 顶成
          // B 的答案；再切回 A 时按 record 最近作答回填。同步失败只留日志。
          // 仅"上次是非空的另一身份"时回填（A→B 直切、B→登出）。null→id 不回填：启动 OAuth
          // 恢复与运行中登录共用该序列且无法区分，宁可少回填——手动修改已由各入口回写
          // record（record=最新偏好），缺失回填只影响"apikey 态后登录旧账号"这类边缘场景。
          const previousUserId = lastSyncedUserIdRef.current;
          lastSyncedUserIdRef.current = userId;
          if (!cancelled && !result && previousUserId != null && previousUserId !== userId) {
            void onboardingRecord
              .syncSettingsFromRecord()
              .then((patch) => {
                if (cancelled || !patch) return;
                return update(patch);
              })
              .catch((cause: unknown) => {
                logger.warn("[occupation-onboarding] 按记录同步偏好失败", {
                  error: String(cause),
                });
              });
          }
        },
        (cause) => {
          logger.warn("[occupation-onboarding] shouldOnboard 检查失败", { error: String(cause) });
          if (!cancelled) setNeedsOnboarding(fallback());
        },
      )
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // 不依赖 hasStoredOccupation（对应 settings?.onboardingOccupation）：保存成功会改写该字段，
    // 若记录写入失败会在当场重开引导；记录缺失导致的再次触发按约定留给下次启动。
  }, [onboardingRecord, userId]);
  return [needsOnboarding, () => setNeedsOnboarding(false)];
}
