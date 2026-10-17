/**
 * Profile Thresholds Config — RFM / 生命周期阈值可配化（G5，客户画像批1 2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批1 + G4/G5 拍板
 *
 * 设计（照抄 dispatch-scores.config.ts 范式，T3 保证金批A 先例）：
 *   - SystemConfig 单键 `profile.thresholds`，值 JSON
 *   - 缺省 / 非法 JSON / 字段非法 → 回退代码常量 PROFILE_THRESHOLDS（R-e 早期数据稀疏应对：上线后调参不改代码）
 *   - 缓存一致性：短 TTL 进程内缓存（60s）——画像查询低频（admin 背调页），无需 Redis 版本号机制
 *   - 派生缓存登记：system-config.service.ts DERIVED_CACHE_KEYS 不需要（本缓存 60s 自过期，运营改配置最多 60s 生效）
 *
 * zod schema 同时供解析器与后续 admin 配置端（批2 看板）共用。
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const PROFILE_THRESHOLDS_KEY = 'profile.thresholds';

/**
 * RFM + 生命周期阈值（全部可配，G5）
 *
 * RFM 口径（R-a 同源红线：聚合基数 = catalog.service.ts:292-303 同源，COMPLETED+CANCELLED、不过滤 deletedAt）：
 *   - R（recency）= 距最近一次购买（聚合基数的 MAX(created_at)）的天数（Dili 当地日历日差）
 *   - F（frequency）= 聚合基数订单数
 *   - M（monetary）= 聚合基数订单实付金额总和（分）
 *
 * 生命周期阶段机（新客→首购→复购→常客→沉睡→流失）判定顺序（自上而下，先命中先归）：
 *   1. NEW        F = 0（无聚合基数订单）
 *   2. FIRST_PURCHASE   F = 1
 *   3. ACTIVE     F ≥ repeatThreshold（复购客）
 *   4. SLEEPING   F ≥ repeatThreshold 且 R > sleepingDays（超期未买）
 *   5. CHURNED    F ≥ repeatThreshold 且 R > churnedDays（超沉睡期仍未买）
 *   注：ACTIVE/SLEEPING/CHURNED 按 repeatThreshold 分界，F 在 2..repeatThreshold-1 的中段用户
 *   无沉睡/流失态（数据量小、阈值可配，批2 分层看板再细化）。
 */
export const ProfileThresholds = z.object({
  /** 复购门槛：F ≥ 该值算常客（默认 3） */
  repeatThreshold: z.number().int().min(2).max(100),
  /** 沉睡天数：R > sleepingDays 算沉睡（默认 30） */
  sleepingDays: z.number().int().min(1).max(365),
  /** 流失天数：R > churnedDays 算流失（默认 90，必须 > sleepingDays） */
  churnedDays: z.number().int().min(1).max(730),
});

/** 阈值类型（zod 推导，供 lifecycle.ts / 服务层共用） */
export type ProfileThresholds = z.infer<typeof ProfileThresholds>;


/** 代码默认值（缺省回退） */
export const PROFILE_THRESHOLDS: ProfileThresholds = {
  repeatThreshold: 3,
  sleepingDays: 30,
  churnedDays: 90,
};

/** 进程内缓存 TTL（ms）——运营改配置最多 60s 生效 */
const THRESHOLDS_CACHE_TTL_MS = 60_000;
let thresholdsCache: { thresholds: ProfileThresholds; at: number } | null = null;

/** 测试注入用：清进程内缓存 */
export function resetProfileThresholdsCacheForTest(): void {
  thresholdsCache = null;
}

/**
 * 解析阈值 JSON → ProfileThresholds；任何异常回退代码常量。
 * 纯函数（单测友好）：不触 DB。含 churnedDays > sleepingDays 交叉校验。
 */
export function parseProfileThresholds(raw: string | null | undefined): ProfileThresholds {
  if (!raw) return { ...PROFILE_THRESHOLDS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ProfileThresholds.safeParse(parsed);
    if (!result.success) {
      logger.warn({
        msg: 'PROFILE_THRESHOLDS_PARSE_FALLBACK',
        reason: result.error.issues[0]?.message ?? 'schema mismatch',
      });
      return { ...PROFILE_THRESHOLDS };
    }
    if (result.data.churnedDays <= result.data.sleepingDays) {
      logger.warn({
        msg: 'PROFILE_THRESHOLDS_PARSE_FALLBACK',
        reason: 'churnedDays must be > sleepingDays',
      });
      return { ...PROFILE_THRESHOLDS };
    }
    return result.data;
  } catch {
    logger.warn({ msg: 'PROFILE_THRESHOLDS_PARSE_FALLBACK', reason: 'invalid JSON' });
    return { ...PROFILE_THRESHOLDS };
  }
}

/**
 * 读生效阈值（进程内 60s TTL 缓存；DB 未配置回退常量）。
 * Redis 异常不炸（画像查询是只读展示，降级走常量）。
 */
export async function getProfileThresholds(): Promise<ProfileThresholds> {
  const now = Date.now();
  if (thresholdsCache && now - thresholdsCache.at < THRESHOLDS_CACHE_TTL_MS) {
    return thresholdsCache.thresholds;
  }
  let thresholds: ProfileThresholds;
  try {
    const raw = await db.systemConfig.findUnique({ where: { key: PROFILE_THRESHOLDS_KEY } });
    thresholds = parseProfileThresholds(raw?.value ?? null);
  } catch (err) {
    logger.warn({
      msg: 'PROFILE_THRESHOLDS_DB_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    thresholds = { ...PROFILE_THRESHOLDS };
  }
  thresholdsCache = { thresholds, at: now };
  return thresholds;
}
