/**
 * 限流计数器（Redis INCR + EXPIRE）
 *
 * 决策依据：契约 v0.2 §4.3 SMS 短信限流策略
 *   - 同手机号：60s 内 1 条，1h 内 5 条，24h 内 10 条
 *   - 同 IP：1h 内 20 条
 *   - 超限响应 429 RATE_LIMIT_EXCEEDED，details.retryAfter
 *
 * 通用模式：按 key + window 时间窗口计数
 */
import { redis } from './redis';

export interface RateLimitResult {
  /** 是否允许通过 */
  allowed: boolean;
  /** 当前窗口内已使用次数 */
  current: number;
  /** 窗口上限 */
  limit: number;
  /** 距离下次可用的秒数（超限时返回，>0） */
  retryAfter: number;
}

/**
 * 滑动窗口限流检查
 *
 * @param key 限流 key（如 `sms:phone:+67012345678:60s`）
 * @param limit 窗口内最大次数
 * @param windowSeconds 窗口大小（秒）
 * @returns RateLimitResult
 *
 * 用法：
 *   const r = await rateLimit('sms:phone:+67012345678:60s', 1, 60);
 *   if (!r.allowed) throw new Error(`SMS_RATE_LIMIT retryAfter=${r.retryAfter}`);
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const k = `ratelimit:${key}`;
  const current = await redis.incr(k);

  // 第一次 INCR 时设置 TTL（后续 INCR 不重置）
  if (current === 1) {
    await redis.expire(k, windowSeconds);
  }

  if (current > limit) {
    const ttl = await redis.ttl(k);
    return {
      allowed: false,
      current,
      limit,
      retryAfter: ttl > 0 ? ttl : windowSeconds,
    };
  }

  return {
    allowed: true,
    current,
    limit,
    retryAfter: 0,
  };
}

/**
 * SMS 限流策略组合（契约 v0.2 §4.3）
 *
 * 触发任意一条 → 拒绝
 */
export async function checkSmsRateLimit(phone: string, ip: string): Promise<RateLimitResult> {
  const checks = [
    await rateLimit(`sms:phone:${phone}:60s`, 1, 60),
    await rateLimit(`sms:phone:${phone}:1h`, 5, 3600),
    await rateLimit(`sms:phone:${phone}:24h`, 10, 86400),
    await rateLimit(`sms:ip:${ip}:1h`, 20, 3600),
  ];

  // 返回第一个超限的（让客户端知道 retryAfter）
  for (const c of checks) {
    if (!c.allowed) return c;
  }

  // 全过，返回最严格的（60s 内的状态供调试）
  return checks[0];
}
