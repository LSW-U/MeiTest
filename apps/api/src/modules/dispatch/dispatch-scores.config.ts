/**
 * Dispatch Score Weights Config — 派单排序权重可配化（保证金批A T2，2026-09-10）
 *
 * 方案：方案v2-保证金拦截链与可配化-20260910 §0 T2 + §2.2 dispatch.service 行
 *
 * 设计：
 *   - SystemConfig 单键 `dispatch.score_weights`，值 JSON `{"rating":0.5,"distance":0.3,"inTransit":0.2}`
 *   - 缺省 / 非法 JSON / 字段缺失 / 和≠1 → 回退代码常量 DISPATCH_SCORE_WEIGHTS（v2 风险 5）
 *   - 缓存一致性走 T3 Redis 版本号（getScoreWeights 先比对 `config:dispatch:weights:ver`
 *     vs 进程内 ver，不一致回源 DB），照抄 catalog COUNT_VER_KEY 先例（catalog.service.ts:513-580）
 *   - SystemConfig DEL 派生缓存登记：system-config.service.ts DERIVED_CACHE_KEYS 加
 *     `dispatch.score_weights` → `config:dispatch:weights:ver` bump 由本服务 bumpWeightsVersion 提供
 *
 * zod schema（和=1 refine）同时供 admin 配置端（批C）与解析器共用。
 */
import { z } from 'zod';
import { db } from '../../shared/db';
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { DISPATCH_SCORE_WEIGHTS } from '../rider/deposit-eligibility.service';

/** 权重 shape + 和=1 校验（v2 T2 决策：权重和必须=1） */
export const ScoreWeightsSchema = z
  .object({
    rating: z.number().min(0).max(1),
    distance: z.number().min(0).max(1),
    inTransit: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(w.rating + w.distance + w.inTransit - 1) < 1e-9, {
    message: 'weights sum must equal 1',
  });

export type ScoreWeights = z.infer<typeof ScoreWeightsSchema>;

/** 权重缓存版本号 key（redis.ts Proxy 自动加 meimart: 前缀） */
export const DISPATCH_WEIGHTS_VER_KEY = 'config:dispatch:weights:ver';

/** SystemConfig 单键 */
const CONFIG_KEY = 'dispatch.score_weights';

/** 进程内缓存（版本号 + 值；60s TTL 兜底 Redis 异常降级路径） */
const WEIGHTS_CACHE_TTL_MS = 60_000;
let weightsCache: { ver: number; weights: ScoreWeights; at: number } | null = null;

/**
 * 解析权重 JSON → ScoreWeights；任何异常回退代码常量。
 * 纯函数（单测友好）：不触 DB / Redis。
 */
export function parseScoreWeights(raw: string | null | undefined): ScoreWeights {
  if (!raw) return { ...DISPATCH_SCORE_WEIGHTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = ScoreWeightsSchema.safeParse(parsed);
    if (!result.success) {
      logger.warn({
        msg: 'DISPATCH_WEIGHTS_PARSE_FALLBACK',
        reason: result.error.issues[0]?.message ?? 'schema mismatch',
      });
      return { ...DISPATCH_SCORE_WEIGHTS };
    }
    return result.data;
  } catch {
    logger.warn({ msg: 'DISPATCH_WEIGHTS_PARSE_FALLBACK', reason: 'invalid JSON' });
    return { ...DISPATCH_SCORE_WEIGHTS };
  }
}

/** 读版本号；redis 空时默认 0（与 catalog getCountVersion 同语义） */
async function getWeightsVersion(): Promise<number> {
  const v = await redis.get(DISPATCH_WEIGHTS_VER_KEY);
  return v ? Number(v) : 0;
}

/**
 * bump 权重版本号（fire-and-forget 调用，失败吞掉——旧缓存等 TTL 过期兜底）
 * 调用点：system-config update `dispatch.score_weights` 后（通过 DERIVED_CACHE_KEYS 派生登记
 * 语义）/ admin 权重保存路径。
 */
export async function bumpDispatchWeightsVersion(): Promise<void> {
  try {
    await redis.incr(DISPATCH_WEIGHTS_VER_KEY);
  } catch (err) {
    logger.warn({
      msg: 'DISPATCH_WEIGHTS_BUMP_FAILED',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * 读生效权重（带 Redis 版本号 + 进程内缓存）：
 *   1. Redis 可用：比对版本号，版本变了强制回源 DB 并更新本地 ver
 *   2. Redis 异常：跳过版本比对走本地 60s TTL（行为退回现状，log.warn 不炸，v2 风险 4）
 *   3. 全 miss：回源 DB；DB 也没配 → 回退常量（parseScoreWeights(null)）
 */
export async function getScoreWeights(): Promise<ScoreWeights> {
  const now = Date.now();
  try {
    const ver = await getWeightsVersion();
    if (weightsCache && weightsCache.ver === ver && now - weightsCache.at < WEIGHTS_CACHE_TTL_MS) {
      return weightsCache.weights;
    }
    const raw = await db.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
    const weights = parseScoreWeights(raw?.value ?? null);
    weightsCache = { ver, weights, at: now };
    return weights;
  } catch (err) {
    // Redis 异常降级：本地 TTL 兜底（行为退回改造前：60s 内不变）
    logger.warn({
      msg: 'DISPATCH_WEIGHTS_REDIS_DEGRADED',
      error: err instanceof Error ? err.message : String(err),
    });
    if (weightsCache && now - weightsCache.at < WEIGHTS_CACHE_TTL_MS) {
      return weightsCache.weights;
    }
    const raw = await db.systemConfig
      .findUnique({ where: { key: CONFIG_KEY } })
      .catch(() => null);
    const weights = parseScoreWeights(raw?.value ?? null);
    weightsCache = { ver: -1, weights, at: now };
    return weights;
  }
}

/** 清进程内权重缓存（测试注入用；生产路径靠版本号比对自然失效） */
export function resetScoreWeightsCacheForTest(): void {
  weightsCache = null;
}
