/**
 * Engagement Frequency Cap — E3 推送频控闸（批4 2026-10-18）
 *
 * 方案：方案v2 §三 批4 + 订正 #6：E3 是**业务级** Redis 计数，非 HTTP rate-limit.guard
 *（rate-limit.guard 是端点级滑动窗口，语义不同不复用；只借鉴其 Redis 原子计数思路）。
 *
 * 语义：
 *   - key（ioredis keyPrefix 自动拼 meimart:）：
 *       push:cap:{userId}:d:{yyyymmdd}   日窗口
 *       push:cap:{userId}:w:{isoWeek}    周窗口（ISO 周，周一起算）
 *   - tryConsume：原子 INCR；首次（=1）设 TTL 到窗口自然过期；计数 > 上限 → 拒绝且不回滚
 *     （回滚会让"同一次触达重试"绕过频控；拒绝即不发送，无需归还）
 *   - 窗口期计算用 Dili 本地日历（Asia/Dili，与 R/thresholds 口径一致）
 *   - Redis 异常 fail-safe：**放行**（触达是增值功能，Redis 挂了不应阻断全部流；
 *     与 sms 频控 fail-closed 相反——sms 是成本/安全问题，本闸只是体验问题）
 */
import { redis } from '../../shared/cache/redis';
import { logger } from '../../shared/logger/logger';
import { MARKET_TIMEZONE } from '../../shared/datetime';

/** 频控判定结果 */
export interface PushCapResult {
  allowed: boolean;
  /** 日窗口当前计数（拒绝时=超限后的值；Redis 异常=0） */
  dailyCount: number;
  /** 周窗口当前计数 */
  weeklyCount: number;
}

/** 日窗口 key：push:cap:{userId}:d:{yyyymmdd}（Dili 本地日历） */
export function pushCapDailyKey(userId: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `push:cap:${userId}:d:${y}${m}${d}`;
}

/** 周窗口 key：push:cap:{userId}:w:{G-Www}（ISO 周，周一起算；跨年周正确） */
export function pushCapWeeklyKey(userId: string, now: Date = new Date()): string {
  // en-CA 的 week 计法未必 ISO，用 Intl 'u-nu' 不稳——手算 ISO 周号（Dili 固定 UTC+9 无 DST）
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const d = Number(parts.find((p) => p.type === 'day')!.value);
  // UTC 毫秒合成 Dili 墙钟日，再算 ISO 周（standard algorithm）
  const t = Date.UTC(y, m - 1, d);
  const date = new Date(t);
  const dayNum = (date.getUTCDay() + 6) % 7; // 周一=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // 本周四
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
  const week = 1 + Math.round((t - firstThursday.getTime()) / (7 * 86_400_000));
  return `push:cap:${userId}:w:${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** 当日（Dili）剩余秒数（TTL 用；窗口自然过期） */
function secondsUntilMidnightTz(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const secOfDay = v('hour') * 3600 + v('minute') * 60 + v('second');
  return 86_400 - secOfDay + 60; // +60s 余量防边界提前过期
}

/** 周窗口 TTL：固定 8 天（跨周必过期，无需精确到下周一） */
const WEEKLY_TTL_SEC = 8 * 86_400;

/**
 * 频控尝试消耗一次推送额度
 *
 * @returns allowed=false 时调用方必须跳过发送并落 skip 留痕（RATE_LIMITED）
 */
export async function tryConsumePushCap(
  userId: string,
  dailyCap: number,
  weeklyCap: number,
  now: Date = new Date(),
): Promise<PushCapResult> {
  const dKey = pushCapDailyKey(userId, now);
  const wKey = pushCapWeeklyKey(userId, now);
  try {
    const dCount = Number((await redis.incr(dKey)) ?? 1);
    if (dCount === 1) await redis.expire(dKey, secondsUntilMidnightTz(now));
    const wCount = Number((await redis.incr(wKey)) ?? 1);
    if (wCount === 1) await redis.expire(wKey, WEEKLY_TTL_SEC);
    const allowed = dCount <= dailyCap && wCount <= weeklyCap;
    return { allowed, dailyCount: dCount, weeklyCount: wCount };
  } catch (err) {
    // fail-safe：Redis 异常放行（触达是增值功能不阻断；告警留痕）
    logger.warn({
      msg: 'PUSH_CAP_REDIS_DEGRADED_ALLOW',
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true, dailyCount: 0, weeklyCount: 0 };
  }
}
