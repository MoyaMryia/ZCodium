/**
 * 自适应并发控制器：一个 provider key 上的纯 AIMD 状态机。
 *
 * 纯包纪律：不读时钟、不做 I/O——`now`（ms since epoch）一律由调用方传入；本类只回答
 * 「cap 现在是多少、能不能准入、这次信号让 cap 变了没有」。谁喂信号、谁排队（bootstrap 的进程级
 * 治理器）都在包外。
 *
 * 度量单位是**模型请求**（每一次尝试）：`inFlight` = 已准入、尚未 release 的请求数。
 * 没有 ask 级计数——一个子代理同时只有一个请求在飞，「≤ N 个请求」与「≤ N 个子代理在跑」等价。
 *
 * 批次阻尼靠 **epoch**：每次准入记下当时的 epoch，每次限流裁决 epoch += 1。一个 429 只在
 * 它的请求是在**当前** cap 下发出（epoch 相同）时才评价当前 cap；旧 epoch 的 429 评价的是一个已被
 * 砍掉的 cap，只清 streak、刷新 cooldown。成功同理：只有当前 epoch 的成功计入 streak。
 *
 * 信号方法都返回本次信号引起的 cap 变化列表（通常 0 或 1 条；空闲重置紧接着一次限流时会是 2 条），
 * 调用方原样扇出成 `concurrency-changed` 事件。
 */

import type { ConcurrencyChange, ConcurrencyChangeReason } from "./types.js";

/**
 * 限流即 `cap = max(FLOOR, floor(cap × 0.75))`（系数从 0.5 改为 0.75）：
 * 减半对「只多了一两个」的越界反应过猛——闸门是请求级的，一次 429 说明 cap 高了，很少说明高了一倍。
 */
export const CONCURRENCY_DECREASE_FACTOR = 0.75;
/** 加性递增步长。 */
export const CONCURRENCY_INCREASE_STEP = 1;
/**
 * 每 +1 需要的连续成功模型请求数 K。只有一档。该值从 40 降到 4：
 * 探测失败的代价只是一个请求撞一次 429 然后退回 `lastGood`（已证明可用的水位），不值得用 40 次
 * 成功去换一次试探。
 */
export const CONCURRENCY_INCREASE_AFTER_SUCCESSES = 4;
/** 永远至少有一个探针在跑。 */
export const CONCURRENCY_FLOOR = 1;
/** 某 key 空闲这么久（且无在飞）后遗忘学到的 cap，回天花板。 */
export const CONCURRENCY_IDLE_RESET_MS = 300_000;

/** 会令 cap 减少的限流类原因。 */
export type ConcurrencyThrottleReason = Extract<
  ConcurrencyChangeReason,
  "rate_limited" | "provider_overloaded"
>;

/** 控制器的只读快照（供测试断言与治理器投影 run 头的 `concurrency`）。 */
export interface ConcurrencyControllerSnapshot {
  readonly key: string;
  readonly ceiling: number;
  readonly cap: number;
  /** 限流裁决计数；准入时发给请求，请求结束时带回来比对。 */
  readonly epoch: number;
  readonly inFlight: number;
  readonly waiters: number;
  readonly successStreak: number;
  readonly cooldownUntil?: number;
  readonly lastRequestAt?: number;
  readonly lastGood?: number;
  readonly lastBad?: number;
}

export class ConcurrencyController {
  private cap: number;
  private epoch = 0;
  private inFlight = 0;
  private waiters_ = 0;
  private successStreak = 0;
  private cooldownUntil?: number;
  private lastRequestAt?: number;
  private lastGood?: number;
  private lastBad?: number;

  /**
   * @param key provider key（`${providerId}/${modelId}`），只用于填进 change 事件——控制器自己
   *   对它无感。放在构造参数而不是每次信号传入：一个控制器只服务一个 key，这是身份不是参数。
   * @param ceiling CPU 推导的天花板：既是初值也是上界。
   */
  constructor(
    readonly key: string,
    readonly ceiling: number,
  ) {
    this.cap = ceiling;
  }

  snapshot(): ConcurrencyControllerSnapshot {
    return {
      key: this.key,
      ceiling: this.ceiling,
      cap: this.cap,
      epoch: this.epoch,
      inFlight: this.inFlight,
      waiters: this.waiters_,
      successStreak: this.successStreak,
      ...(this.cooldownUntil === undefined ? {} : { cooldownUntil: this.cooldownUntil }),
      ...(this.lastRequestAt === undefined ? {} : { lastRequestAt: this.lastRequestAt }),
      ...(this.lastGood === undefined ? {} : { lastGood: this.lastGood }),
      ...(this.lastBad === undefined ? {} : { lastBad: this.lastBad }),
    };
  }

  /**
   * 闸门（准入条件）：在飞请求数低于 cap 且不在 Retry-After 冷却中。纯查询，不做空闲重置——
   * 调用方（治理器）在准入路径上先调 {@link observe}（准入也是一次「信号」，空闲一小时后的第一个
   * run 要立刻从天花板起步）。
   */
  canAdmit(now: number): boolean {
    return (
      this.inFlight < this.cap && (this.cooldownUntil === undefined || now >= this.cooldownUntil)
    );
  }

  /** 只做空闲重置检查的「空信号」（准入前、observer 放行前用）。 */
  observe(now: number): ConcurrencyChange[] {
    return this.idleReset(now);
  }

  /**
   * 一个请求被准入：`inFlight++`、刷新 `lastRequestAt`，返回它所属的 epoch（请求结束时带回来）。
   * 不做空闲重置——调用方已在 {@link observe} 里做过；这里若再做，一个刚被 observe 判定「不空闲」
   * 的准入不可能变成空闲。
   */
  admitted(now: number): number {
    this.lastRequestAt = now;
    this.inFlight += 1;
    return this.epoch;
  }

  /**
   * 一个请求成功结束：`inFlight--`；只有**当前 epoch** 的成功使
   * `successStreak++`——旧 epoch 的成功证明的是旧 cap 下退避压低后的负载，不是新 cap 可以更高。
   * `successStreak ≥ K` 即**证明**当前 cap 可用：`lastGood = max(lastGood, cap)`（只有
   * 完成的 streak 能设 lastGood，减少 cap 不能）。再满足有等待者 **且** `cap < ceiling` → +1。
   * 无等待者时 streak 照累积但不兑现。
   */
  succeeded(now: number, epoch: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (epoch !== this.epoch) return changes;
    this.successStreak += 1;
    if (this.successStreak < CONCURRENCY_INCREASE_AFTER_SUCCESSES) return changes;
    // 这一级被一整段 streak 证明可用——不论此刻有没有人等着往上爬。
    if (this.lastGood === undefined || this.cap > this.lastGood) this.lastGood = this.cap;
    if (this.waiters_ <= 0 || this.cap >= this.ceiling) return changes;
    const previous = this.cap;
    this.cap = Math.min(this.ceiling, previous + CONCURRENCY_INCREASE_STEP);
    this.successStreak = 0;
    changes.push(this.change(previous, "recovered"));
    return changes;
  }

  /**
   * 被限流/过载。一律 `inFlight--`、清 streak、带 Retry-After 则把 cooldown
   * 推到更晚者。
   *
   * 只有 `epoch === 当前 epoch` 的 429 才动 cap：它是在当前 cap 下发出的请求，是对当前 cap 的评价；
   * 旧 epoch 的 429 忽略（不发事件）。当前 epoch 的分两档：在 `lastGood` **之上**探测被限流 → 退回
   * `lastGood`（记 `lastBad`，不按系数减）；否则（`lastGood` 缺席或 `cap ≤ lastGood`：墙下移了）→
   * `cap = max(FLOOR, floor(cap × 0.75))`，记 `lastBad = 旧 cap`，并**清掉** `lastGood`——它刚被
   * 证伪，而新 cap 还没被任何 streak 证明（减 cap 不设 lastGood）。两档之后 `epoch += 1`——
   * 即便 cap 已在地板、数值没变，也翻一页：同一批请求只能触发一次裁决。
   */
  throttled(
    now: number,
    epoch: number,
    reason: ConcurrencyThrottleReason,
    retryAfterMs?: number,
  ): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.successStreak = 0;
    const cooldownMs = retryAfterMs !== undefined && retryAfterMs > 0 ? retryAfterMs : undefined;
    if (cooldownMs !== undefined) {
      this.cooldownUntil = Math.max(this.cooldownUntil ?? 0, now + cooldownMs);
    }
    if (epoch !== this.epoch) return changes;

    const previous = this.cap;
    if (this.lastGood !== undefined && this.cap > this.lastGood) {
      this.lastBad = this.cap;
      this.cap = this.lastGood;
    } else {
      this.cap = Math.max(CONCURRENCY_FLOOR, Math.floor(this.cap * CONCURRENCY_DECREASE_FACTOR));
      this.lastBad = previous;
      this.lastGood = undefined;
    }
    this.epoch += 1;
    // cap 已在地板且无 Retry-After 时确实什么都没变，不发事件；带 Retry-After 的限流即便 cap 不动
    // 也要让 run 头知道「冷却至…」，所以带 cooldownMs 的一律发。
    if (previous === this.cap && cooldownMs === undefined) return changes;
    changes.push(this.change(previous, reason, cooldownMs));
    return changes;
  }

  /** 瞬态但非限流的失败（timeout / 5xx / 网络）：`inFlight--`、清 streak，cap 不动。 */
  failedTransient(now: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.successStreak = 0;
    return changes;
  }

  /** 一个请求以永久失败 / 取消终结，或 ticket 只见 release 没见终结事件：只做 `inFlight--`。 */
  ended(now: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.inFlight = Math.max(0, this.inFlight - 1);
    return changes;
  }

  /** 治理器在队列变化时喂入的等待者数（有需求才加 cap）。 */
  waiters(now: number, count: number): ConcurrencyChange[] {
    const changes = this.idleReset(now);
    this.waiters_ = Math.max(0, count);
    return changes;
  }

  // ——————————————————————————————— 内部 ———————————————————————————————

  /**
   * 空闲重置：`now − lastRequestAt ≥ IDLE_RESET_MS` 且无在飞 → cap 回天花板，
   * 清 streak / cooldown / lastGood / lastBad，epoch += 1。惰性发生在任一信号到达时（无定时器）。
   */
  private idleReset(now: number): ConcurrencyChange[] {
    if (
      this.lastRequestAt === undefined ||
      this.inFlight !== 0 ||
      now - this.lastRequestAt < CONCURRENCY_IDLE_RESET_MS
    ) {
      return [];
    }
    const previous = this.cap;
    // 幂等：已在天花板且状态干净时什么都不做（否则每个空闲信号都翻一页 epoch）。
    if (
      previous === this.ceiling &&
      this.successStreak === 0 &&
      this.cooldownUntil === undefined &&
      this.lastGood === undefined &&
      this.lastBad === undefined
    ) {
      return [];
    }
    this.cap = this.ceiling;
    this.successStreak = 0;
    this.cooldownUntil = undefined;
    this.lastGood = undefined;
    this.lastBad = undefined;
    this.epoch += 1;
    // lastRequestAt 保留：下一次仍空闲的信号不该再「重置」一次；此时状态已处于天花板。
    return previous === this.cap ? [] : [this.change(previous, "idle_reset")];
  }

  private change(
    previous: number,
    reason: ConcurrencyChangeReason,
    cooldownMs?: number,
  ): ConcurrencyChange {
    return {
      key: this.key,
      previous,
      next: this.cap,
      reason,
      ...(this.lastGood === undefined ? {} : { lastGood: this.lastGood }),
      ...(this.lastBad === undefined ? {} : { lastBad: this.lastBad }),
      ...(cooldownMs === undefined ? {} : { cooldownMs }),
    };
  }
}
