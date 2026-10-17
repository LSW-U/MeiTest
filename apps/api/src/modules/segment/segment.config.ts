/**
 * Segment Config — 批2 分层运营可配项（G5，2026-10-18）
 *
 * SystemConfig 单键 `segment.batchGrant`：
 *   { "batchLimit": 500, "rateLimitPerMinute": 1 }
 *
 * 语义：
 *   - batchLimit          批量发券单批上限（R-f 防误操作群发；服务层另有硬顶 5000）
 *   - rateLimitPerMinute  grant 端点每分钟可调用次数（滑动窗口频控）
 *
 * 缺省/非法 JSON/字段非法 → 回退代码常量（与 profile.config.ts parse-fallback 同范式）。
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const SEGMENT_CONFIG_KEY = 'segment.batchGrant';

/** grant 频控 Redis key（rateLimit 拼 ratelimit: 前缀） */
export const SEGMENT_BATCH_GRANT_KEY = 'segment:grant:60s';

/** 批量发券单批上限默认值 */
export const SEGMENT_BATCH_GRANT_DEFAULT_LIMIT = 500;

/** grant 每分钟调用上限默认值 */
export const SEGMENT_BATCH_GRANT_DEFAULT_RPM = 1;

export const SegmentBatchGrantConfig = z.object({
  batchLimit: z.number().int().min(1).max(10_000),
  rateLimitPerMinute: z.number().int().min(1).max(60),
});

export type SegmentBatchGrantConfigValue = z.infer<typeof SegmentBatchGrantConfig>;

/** 代码默认值（缺省回退） */
export const SEGMENT_BATCH_GRANT_CONFIG: SegmentBatchGrantConfigValue = {
  batchLimit: SEGMENT_BATCH_GRANT_DEFAULT_LIMIT,
  rateLimitPerMinute: SEGMENT_BATCH_GRANT_DEFAULT_RPM,
};

/** 进程内缓存（60s 自过期，同 profile.config 范式） */
const CACHE_TTL_MS = 60_000;
let cache: { value: SegmentBatchGrantConfigValue; at: number } | null = null;

/** 单测重置缓存 */
export function resetSegmentConfigCacheForTest(): void {
  cache = null;
}

/**
 * 读取批量发券配置（缓存 60s；非法回退默认并告警）
 */
export async function getSegmentBatchGrantConfig(): Promise<SegmentBatchGrantConfigValue> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  let value = SEGMENT_BATCH_GRANT_CONFIG;
  try {
    const row = await db.systemConfig.findUnique({ where: { key: SEGMENT_CONFIG_KEY } });
    if (row?.value) {
      const parsed = SegmentBatchGrantConfig.safeParse(
        typeof row.value === 'string' ? JSON.parse(row.value) : row.value,
      );
      if (parsed.success) {
        value = parsed.data;
      } else {
        logger.warn({ msg: 'SEGMENT_CONFIG_PARSE_FALLBACK', key: SEGMENT_CONFIG_KEY });
      }
    }
  } catch (e) {
    logger.warn({
      msg: 'SEGMENT_CONFIG_READ_FALLBACK',
      key: SEGMENT_CONFIG_KEY,
      err: e instanceof Error ? e.message : String(e),
    });
  }
  cache = { value, at: Date.now() };
  return value;
}

/**
 * 便捷读取：单批上限（数字）
 */
export async function parseSegmentBatchGrantLimit(): Promise<number> {
  const cfg = await getSegmentBatchGrantConfig();
  return cfg.batchLimit;
}

/** 便捷读取：每分钟调用上限 */
export async function parseSegmentBatchGrantRpm(): Promise<number> {
  const cfg = await getSegmentBatchGrantConfig();
  return cfg.rateLimitPerMinute;
}
