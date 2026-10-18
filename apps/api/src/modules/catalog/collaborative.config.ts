/**
 * Collaborative Filtering Config — 批6 协同过滤可配阈值（G5，2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批6（E4 已拍板做）
 *
 * SystemConfig 单键 `recommendation.collaborative`，值 JSON（partial merge，同 engagement.config 范式）：
 *   {
 *     "recomputeCronHours": 6,      // 离线重算频率（小时，1-168）；scheduler 按此注册 cron（P3-2：真实可配）
 *     "neighborTopK": 20,           // 每个用户取相似度 top K 邻居
 *     "minNeighborScore": 0.1,      // 邻居相似度下界（低于不纳入）
 *     "picksPerUser": 10,           // 每用户物化推荐条数上限
 *     "minSourceCount": 1,          // 结果行最少邻居证据数（低于不入库）
 *     "similarityWindowDays": 90,   // 共现统计订单时间窗口（天）
 *     "b7SimilarWeight": 0.3        // B7 融合排序中相似用户信号权重（0-1；其余给类目加权序）
 *   }
 *
 * 设计照抄 behavior.config.ts 范式：
 *   - 缺省 / 非法 JSON / 字段非法（zod safeParse）→ 回退代码常量（fail-safe）
 *   - 60s 进程内缓存自过期
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const COLLABORATIVE_CONFIG_KEY = 'recommendation.collaborative';

export const CollaborativeConfig = z.object({
  recomputeCronHours: z.number().int().min(1).max(168).optional(),
  neighborTopK: z.number().int().min(1).max(100).optional(),
  minNeighborScore: z.number().min(0).max(1).optional(),
  picksPerUser: z.number().int().min(1).max(50).optional(),
  minSourceCount: z.number().int().min(1).max(20).optional(),
  similarityWindowDays: z.number().int().min(7).max(365).optional(),
  b7SimilarWeight: z.number().min(0).max(1).optional(),
});

export type CollaborativeConfigValue = z.infer<typeof CollaborativeConfig> & {
  recomputeCronHours: number;
  neighborTopK: number;
  minNeighborScore: number;
  picksPerUser: number;
  minSourceCount: number;
  similarityWindowDays: number;
  b7SimilarWeight: number;
};

export const COLLABORATIVE_DEFAULTS: CollaborativeConfigValue = {
  recomputeCronHours: 6,
  neighborTopK: 20,
  minNeighborScore: 0.1,
  picksPerUser: 10,
  minSourceCount: 1,
  similarityWindowDays: 90,
  b7SimilarWeight: 0.3,
};

const COLLAB_CACHE_TTL_MS = 60_000;
let collabCache: { value: CollaborativeConfigValue; at: number } | null = null;

/** 单测重置缓存 */
export function resetCollaborativeConfigCacheForTest(): void {
  collabCache = null;
}

/** 解析合并（partial 覆盖默认；非法回退全默认） */
export function parseCollaborativeConfig(raw: string | null | undefined): CollaborativeConfigValue {
  if (!raw) return { ...COLLABORATIVE_DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = CollaborativeConfig.safeParse(parsed);
    if (!result.success) {
      logger.warn({
        msg: 'COLLABORATIVE_CONFIG_PARSE_FALLBACK',
        reason: 'zod safeParse failed',
      });
      return { ...COLLABORATIVE_DEFAULTS };
    }
    return { ...COLLABORATIVE_DEFAULTS, ...result.data };
  } catch {
    logger.warn({ msg: 'COLLABORATIVE_CONFIG_PARSE_FALLBACK', reason: 'invalid JSON' });
    return { ...COLLABORATIVE_DEFAULTS };
  }
}

/** 读生效配置（进程内 60s TTL 缓存；DB 异常降级默认值） */
export async function getCollaborativeConfig(): Promise<CollaborativeConfigValue> {
  const now = Date.now();
  if (collabCache && now - collabCache.at < COLLAB_CACHE_TTL_MS) {
    return collabCache.value;
  }
  let value: CollaborativeConfigValue;
  try {
    const row = await db.systemConfig.findUnique({ where: { key: COLLABORATIVE_CONFIG_KEY } });
    value = parseCollaborativeConfig(row?.value ?? null);
  } catch (err) {
    logger.warn({
      msg: 'COLLABORATIVE_CONFIG_DB_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    value = { ...COLLABORATIVE_DEFAULTS };
  }
  collabCache = { value, at: now };
  return value;
}
