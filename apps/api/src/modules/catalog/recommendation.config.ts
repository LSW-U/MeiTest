/**
 * Recommendation Config — B7 个性化总闸可配化（客户画像批3 2026-10-18）
 *
 * 方案：方案v2-客户画像与个性化运营-20261017 §三 批3（B7 收窄）+ 订正#2 + 2026-10-18 裁决
 *
 * 裁决语义（预留总闸）：
 *   - SystemConfig 单键 `recommendation.personalRankingEnabled`，默认 false
 *   - **本批 OFF=ON=现状加权行为不变**（类目偏好加权已在个性化推荐批2 R1 上线且维持生效）
 *   - 开关是批6「协同过滤 + B7 全量千人千面」的总闸预留位：批6 接管时在此键上分支
 *   - P3-2 回归红线「默认关时与 3c05738 现状逐字节一致」天然满足（行为不分支）
 *
 * 设计照抄 profile.config.ts 范式（dispatch-scores.config.ts T3 先例）：
 *   - 缺省 / 非法 JSON / 非布尔 → 回退 false（fail-safe：默认关）
 *   - 60s 进程内缓存自过期，运营改配置最多 60s 生效；DERIVED_CACHE_KEYS 不需要登记
 *   - 值兼容两种 JSON 形态：裸布尔 `true` / 对象 `{"personalRankingEnabled":true}`
 */
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

/** SystemConfig 单键 */
export const PERSONAL_RANKING_ENABLED_KEY = 'recommendation.personalRankingEnabled';

/** 代码默认值（缺省回退；fail-safe 默认关） */
export const PERSONAL_RANKING_ENABLED_DEFAULT = false;

/** 进程内缓存 TTL（ms） */
const RANKING_CACHE_TTL_MS = 60_000;
let rankingCache: { enabled: boolean; at: number } | null = null;

/** 测试注入用：清进程内缓存 */
export function resetRecommendationConfigCacheForTest(): void {
  rankingCache = null;
}

/**
 * 解析开关 JSON → boolean；任何异常回退默认 false。
 * 纯函数（单测友好）：不触 DB。兼容裸布尔与对象两种形态。
 */
export function parsePersonalRankingEnabled(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') return PERSONAL_RANKING_ENABLED_DEFAULT;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'boolean') return parsed;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'personalRankingEnabled' in parsed &&
      typeof (parsed as { personalRankingEnabled: unknown }).personalRankingEnabled === 'boolean'
    ) {
      return (parsed as { personalRankingEnabled: boolean }).personalRankingEnabled;
    }
    logger.warn({
      msg: 'PERSONAL_RANKING_PARSE_FALLBACK',
      reason: 'value is neither boolean nor {personalRankingEnabled:boolean}',
    });
    return PERSONAL_RANKING_ENABLED_DEFAULT;
  } catch {
    logger.warn({ msg: 'PERSONAL_RANKING_PARSE_FALLBACK', reason: 'invalid JSON' });
    return PERSONAL_RANKING_ENABLED_DEFAULT;
  }
}

/**
 * 读生效开关（进程内 60s TTL 缓存；DB 未配置回退 false）。
 * DB 异常不炸（只读配置，降级走默认关）。
 */
export async function getPersonalRankingEnabled(): Promise<boolean> {
  const now = Date.now();
  if (rankingCache && now - rankingCache.at < RANKING_CACHE_TTL_MS) {
    return rankingCache.enabled;
  }
  let enabled: boolean;
  try {
    const raw = await db.systemConfig.findUnique({ where: { key: PERSONAL_RANKING_ENABLED_KEY } });
    enabled = parsePersonalRankingEnabled(raw?.value ?? null);
  } catch (err) {
    logger.warn({
      msg: 'PERSONAL_RANKING_DB_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    enabled = PERSONAL_RANKING_ENABLED_DEFAULT;
  }
  rankingCache = { enabled, at: now };
  return enabled;
}
