/**
 * Engagement Config — 批4 触达自动化可配阈值（G5，2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批4 + 订正 #6（E3 业务级 Redis 计数）
 *
 * SystemConfig 单键 `engagement.flows`，值 JSON：
 *   {
 *     "retentionDays": 30,        // C1 挽留：R（距最近购买日历日）≥ 该值且未触达过 → 定向券 + 推送
 *     "firstPurchaseDays": 7,     // C2 首购转化：注册 N 天仍无首单 → 新人推送
 *     "thanksOrderCount": 3,      // C3 复购感谢：第 N 单完成 → 感谢 + 评价邀请
 *     "birthdayLeadDays": 3,      // C6 生日：birthDate 提前 N 天触达（Dili 本地日历）
 *     "replenishCheckHours": 24,  // B2 补货：周期到期扫描粒度（小时）；到期即提醒
 *     "cartRecallHours": 24,      // B3 购物车召回：遗留 ≥ N 小时未变
 *     "pushCapDaily": 2,          // E3 频控：每用户每日自动化推送上限
 *     "pushCapWeekly": 5          // E3 频控：每用户每周自动化推送上限
 *   }
 *
 * 设计照抄 profile.config.ts / segment.config.ts 范式：
 *   - 缺省 / 非法 JSON / 字段非法（zod safeParse）→ 回退代码常量（fail-safe）
 *   - 60s 进程内缓存自过期（定时扫描分钟级，60s 配置生效延迟可接受）
 *   - 节日规则（C6 附加触达日）本批不落配置——验收后运营再填（任务书批4 §2）
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const ENGAGEMENT_FLOWS_KEY = 'engagement.flows';

/** 流规则 schema（全部可配，G5） */
export const EngagementFlowConfig = z.object({
  /** C1 挽留：沉睡判定天数（R ≥ 该值触发） */
  retentionDays: z.number().int().min(1).max(365).optional(),
  /** C2 首购转化：注册 N 天无首单触发 */
  firstPurchaseDays: z.number().int().min(1).max(365).optional(),
  /** C3 复购感谢：第 N 单完成触发 */
  thanksOrderCount: z.number().int().min(1).max(100).optional(),
  /** C6 生日：提前 N 天触达 */
  birthdayLeadDays: z.number().int().min(0).max(30).optional(),
  /** B2 补货：周期到期检查粒度（小时，仅扫描节奏语义） */
  replenishCheckHours: z.number().int().min(1).max(168).optional(),
  /** B3 购物车召回：遗留 N 小时未变触发 */
  cartRecallHours: z.number().int().min(1).max(720).optional(),
  /** E3 频控：每用户每日自动化推送上限 */
  pushCapDaily: z.number().int().min(1).max(50).optional(),
  /** E3 频控：每用户每周自动化推送上限 */
  pushCapWeekly: z.number().int().min(1).max(200).optional(),
});

/** 解析合并（partial 覆盖默认——运营只改某几项，其余保持代码默认） */
/** 完整生效配置（partial 解析后与默认值合并，保证字段全量非空） */
export type EngagementFlowConfigValue = z.infer<typeof EngagementFlowConfig> & {
  retentionDays: number;
  firstPurchaseDays: number;
  thanksOrderCount: number;
  birthdayLeadDays: number;
  replenishCheckHours: number;
  cartRecallHours: number;
  pushCapDaily: number;
  pushCapWeekly: number;
};

/** 代码默认值（缺省回退；与方案批4 节一致） */
export const ENGAGEMENT_FLOW_DEFAULTS: EngagementFlowConfigValue = {
  retentionDays: 30,
  firstPurchaseDays: 7,
  thanksOrderCount: 3,
  birthdayLeadDays: 3,
  replenishCheckHours: 24,
  cartRecallHours: 24,
  pushCapDaily: 2,
  pushCapWeekly: 5,
};

/** 进程内缓存 TTL（ms）——运营改配置最多 60s 生效 */
const CONFIG_CACHE_TTL_MS = 60_000;
let configCache: { value: EngagementFlowConfigValue; at: number } | null = null;

/** 单测重置缓存 */
export function resetEngagementConfigCacheForTest(): void {
  configCache = null;
}

/**
 * 解析流规则 JSON → EngagementFlowConfigValue；任何异常回退代码常量。
 * 纯函数（单测友好）：不触 DB。
 */
export function parseEngagementFlowConfig(raw: string | null | undefined): EngagementFlowConfigValue {
  if (!raw) return { ...ENGAGEMENT_FLOW_DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = EngagementFlowConfig.safeParse(parsed);
    if (!result.success) {
      logger.warn({
        msg: 'ENGAGEMENT_CONFIG_PARSE_FALLBACK',
        reason: result.error.issues[0]?.message ?? 'schema mismatch',
      });
      return { ...ENGAGEMENT_FLOW_DEFAULTS };
    }
    return { ...ENGAGEMENT_FLOW_DEFAULTS, ...result.data };
  } catch {
    logger.warn({ msg: 'ENGAGEMENT_CONFIG_PARSE_FALLBACK', reason: 'invalid JSON' });
    return { ...ENGAGEMENT_FLOW_DEFAULTS };
  }
}

/**
 * 读生效流规则（进程内 60s TTL 缓存；DB 未配置回退常量）。
 * DB 异常不炸（定时任务只读配置，降级走默认）。
 */
export async function getEngagementFlowConfig(): Promise<EngagementFlowConfigValue> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_CACHE_TTL_MS) {
    return configCache.value;
  }
  let value: EngagementFlowConfigValue;
  try {
    const row = await db.systemConfig.findUnique({ where: { key: ENGAGEMENT_FLOWS_KEY } });
    value = parseEngagementFlowConfig(row?.value ?? null);
  } catch (err) {
    logger.warn({
      msg: 'ENGAGEMENT_CONFIG_DB_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    value = { ...ENGAGEMENT_FLOW_DEFAULTS };
  }
  configCache = { value, at: now };
  return value;
}

// ============================================================================
// E3 推送频控 Redis key（业务级计数，非 HTTP rate-limit.guard——订正 #6）
//
// key（redis 有 meimart: keyPrefix，业务代码写不带前缀的短 key）：
//   push:cap:{userId}:d:{yyyymmdd}   日窗口（INCR + 当日剩余秒 TTL）
//   push:cap:{userId}:w:{isoWeek}    周窗口（ISO 周，周一起算）
// ============================================================================

/** E3 频控日窗口 key 前缀（测试断言用） */
export const PUSH_CAP_DAILY_KEY_PREFIX = 'push:cap';
