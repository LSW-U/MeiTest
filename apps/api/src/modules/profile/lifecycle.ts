/**
 * Profile Lifecycle — 生命周期阶段机（客户画像批1 2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批1（生命周期阶段机，阈值可配 G5）
 *
 * 纯函数（单测友好）：不触 DB。阶段判定 + 含回退（常客→沉睡）的流转语义
 * 由 getLifecycleStage 输入天然覆盖——同一函数按当前 R/F 值即时判定，
 * 用户状态变化（下单 → R 归零 → 回到常客）即自然"回退"。
 *
 * 判定顺序（先命中先归，见 profile.config.ts 注释）：
 *   NEW(F=0) → FIRST_PURCHASE(F=1) → CHURNED(R>churnedDays) → SLEEPING(R>sleepingDays) → ACTIVE
 */
import type { ProfileThresholds } from './profile.config';

/** 生命周期阶段（契约 CustomerProfile360.lifecycle.stage 同名） */
export type LifecycleStage = 'NEW' | 'FIRST_PURCHASE' | 'ACTIVE' | 'SLEEPING' | 'CHURNED';

/**
 * 判定生命周期阶段
 *
 * @param f 聚合基数订单数（COMPLETED+CANCELLED 口径，R-a 同源）
 * @param rDays 距最近一次购买的天数（Dili 当地日历日差）；F=0 时传 null
 * @param t 阈值（可配，G5）
 */
export function getLifecycleStage(
  f: number,
  rDays: number | null,
  t: ProfileThresholds,
): LifecycleStage {
  if (f <= 0) return 'NEW';
  if (f === 1) return 'FIRST_PURCHASE';
  // F ≥ 2：先按 R 判沉睡/流失（含回退：曾经常客超期未买 → 沉睡 → 流失；
  // 回购 → R 归零 → 自然回到 ACTIVE），F 达 repeatThreshold 才是 ACTIVE 常客
  const r = rDays ?? 0;
  if (r > t.churnedDays) return 'CHURNED';
  if (r > t.sleepingDays) return 'SLEEPING';
  if (f >= t.repeatThreshold) return 'ACTIVE';
  // F 在 2..repeatThreshold-1 且未超期：仍算 FIRST_PURCHASE 段（复购萌芽，未达常客门槛）
  return 'FIRST_PURCHASE';
}
