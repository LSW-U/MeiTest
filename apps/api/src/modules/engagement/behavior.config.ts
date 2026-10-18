/**
 * Behavior Config — 批5 行为采集与订阅类可配阈值（G5，2026-10-18）
 *
 * 方案：方案v2 §三 批5（A5 G4 简单均值 / B4 浏览未买 / A8 流失信号 / C7 降价幅度）
 *
 * SystemConfig 单键 `engagement.behavior`，值 JSON（partial merge，同 engagement.config 范式）：
 *   {
 *     "viewNudgeDays": 3,           // B4：浏览（VIEW）后 ≥ N 天未购买该商品 → nudge 推送
 *     "viewNudgeCapDaily": 1,       // B4：每用户每日浏览未买 nudge 上限（频控闸之外的流内上限）
 *     "replenishIntervalMin": 2,    // A5：周期预测最少购买次数（不足不预测）
 *     "replenishIntervalMax": 3,    // A5：周期预测取最近 N 次间隔均值（G4 简单均值窗口）
 *     "replenishLeadDays": 1,       // A5/C4：预测到期日前 N 天进入提醒窗口
 *     "priceDropPercent": 5,        // C7：价格较订阅时快照降幅 ≥ 该百分比触发
 *     "churnViewDecayDays": 14,     // A8：浏览信号衰减窗口（N 天内的 VIEW 计分）
 *     "churnViewWeight": 0.1        // A8：每笔浏览的信号权重（0-1）
 *   }
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const ENGAGEMENT_BEHAVIOR_KEY = 'engagement.behavior';

export const EngagementBehaviorConfig = z.object({
  viewNudgeDays: z.number().int().min(1).max(90).optional(),
  viewNudgeCapDaily: z.number().int().min(1).max(20).optional(),
  replenishIntervalMin: z.number().int().min(2).max(10).optional(),
  replenishIntervalMax: z.number().int().min(2).max(10).optional(),
  replenishLeadDays: z.number().int().min(0).max(30).optional(),
  priceDropPercent: z.number().int().min(1).max(90).optional(),
  churnViewDecayDays: z.number().int().min(1).max(90).optional(),
  churnViewWeight: z.number().min(0).max(1).optional(),
});

export type EngagementBehaviorConfigValue = z.infer<typeof EngagementBehaviorConfig> & {
  viewNudgeDays: number;
  viewNudgeCapDaily: number;
  replenishIntervalMin: number;
  replenishIntervalMax: number;
  replenishLeadDays: number;
  priceDropPercent: number;
  churnViewDecayDays: number;
  churnViewWeight: number;
};

export const ENGAGEMENT_BEHAVIOR_DEFAULTS: EngagementBehaviorConfigValue = {
  viewNudgeDays: 3,
  viewNudgeCapDaily: 1,
  replenishIntervalMin: 2,
  replenishIntervalMax: 3,
  replenishLeadDays: 1,
  priceDropPercent: 5,
  churnViewDecayDays: 14,
  churnViewWeight: 0.1,
};

const BEHAVIOR_CACHE_TTL_MS = 60_000;
let behaviorCache: { value: EngagementBehaviorConfigValue; at: number } | null = null;

/** 单测重置缓存 */
export function resetEngagementBehaviorCacheForTest(): void {
  behaviorCache = null;
}

/** 解析（partial merge 默认值；非法回退代码常量） */
export function parseEngagementBehaviorConfig(
  raw: string | null | undefined,
): EngagementBehaviorConfigValue {
  if (!raw) return { ...ENGAGEMENT_BEHAVIOR_DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = EngagementBehaviorConfig.safeParse(parsed);
    if (!result.success) {
      logger.warn({
        msg: 'ENGAGEMENT_BEHAVIOR_CONFIG_PARSE_FALLBACK',
        reason: result.error.issues[0]?.message ?? 'schema mismatch',
      });
      return { ...ENGAGEMENT_BEHAVIOR_DEFAULTS };
    }
    return { ...ENGAGEMENT_BEHAVIOR_DEFAULTS, ...result.data };
  } catch {
    logger.warn({ msg: 'ENGAGEMENT_BEHAVIOR_CONFIG_PARSE_FALLBACK', reason: 'invalid JSON' });
    return { ...ENGAGEMENT_BEHAVIOR_DEFAULTS };
  }
}

/** 读生效配置（进程内 60s TTL；DB 异常降级默认值不炸） */
export async function getEngagementBehaviorConfig(): Promise<EngagementBehaviorConfigValue> {
  const now = Date.now();
  if (behaviorCache && now - behaviorCache.at < BEHAVIOR_CACHE_TTL_MS) {
    return behaviorCache.value;
  }
  let value: EngagementBehaviorConfigValue;
  try {
    const row = await db.systemConfig.findUnique({ where: { key: ENGAGEMENT_BEHAVIOR_KEY } });
    value = parseEngagementBehaviorConfig(row?.value ?? null);
  } catch (err) {
    logger.warn({
      msg: 'ENGAGEMENT_BEHAVIOR_CONFIG_DB_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    value = { ...ENGAGEMENT_BEHAVIOR_DEFAULTS };
  }
  behaviorCache = { value, at: now };
  return value;
}

// ============================================================================
// 订阅类型常量（批5 C7/C8 扩展 ClientSubscription.type）
// ============================================================================

/** 订阅类型（REPLENISH=批4 B2 存量语义 / PRICE_ALERT=C7 降价 / RESTOCK_ALERT=C8 到货） */
export const SUBSCRIPTION_TYPES = ['REPLENISH', 'PRICE_ALERT', 'RESTOCK_ALERT'] as const;
export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

export function isSubscriptionType(t: string): t is SubscriptionType {
  return (SUBSCRIPTION_TYPES as readonly string[]).includes(t);
}

/** 埋点类型（BehaviorEvent.type） */
export const BEHAVIOR_EVENT_TYPES = ['VIEW', 'SEARCH_CLICK'] as const;
export type BehaviorEventType = (typeof BEHAVIOR_EVENT_TYPES)[number];

export function isBehaviorEventType(t: string): t is BehaviorEventType {
  return (BEHAVIOR_EVENT_TYPES as readonly string[]).includes(t);
}
