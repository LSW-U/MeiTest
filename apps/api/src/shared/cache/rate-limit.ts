/**
 * 限流计数器（Redis ZSET + Lua 滑动窗口，W7-ext-H 修复 v1.2）
 *
 * v1.2 修订：原实现是固定窗口（INCR + 首次 EXPIRE），注释误标"滑动窗口"。
 * 现升级为真滑动窗口（ZSET + 时间戳），Lua 原子执行，消除边界突刺。
 *
 * 决策依据：契约 v0.2 §4.3 SMS 短信限流策略
 *   - 同手机号：60s 内 1 条，1h 内 5 条，24h 内 10 条
 *   - 同 IP：1h 内 20 条
 *   - 超限响应 429 RATE_LIMIT_EXCEEDED，details.retryAfter
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
 * 滑动窗口限流 Lua 脚本（ZSET + 时间戳，原子执行）
 *
 * 原理：
 *   - ZSET member=唯一序号，score=请求时间戳（毫秒）
 *   - 每次先 ZREMRANGEBYSCORE 清过期成员（score < now - window）
 *   - ZCARD 计数，< limit 则 ZADD 加当前请求
 *   - 超限则算最老成员的剩余 TTL 作为 retryAfter
 *
 * 相比固定窗口：无边界突刺（窗口边界不会突发 2x 流量）
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local nowMs = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local windowSec = tonumber(ARGV[4])

redis.call('ZREMRANGEBYSCORE', key, 0, nowMs - windowMs)
local count = redis.call('ZCARD', key)

if count < limit then
  local seq = redis.call('INCR', key .. ':seq')
  redis.call('ZADD', key, nowMs, seq)
  redis.call('EXPIRE', key, windowSec)
  redis.call('EXPIRE', key .. ':seq', windowSec)
  return {1, count + 1, limit, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldestScore = tonumber(oldest[2])
  if not oldestScore then oldestScore = nowMs end
  local retrySec = math.ceil((oldestScore + windowMs - nowMs) / 1000)
  if retrySec < 1 then retrySec = 1 end
  return {0, count, limit, retrySec}
end
`;

/**
 * 滑动窗口限流检查（Redis ZSET + Lua 原子）
 *
 * @param key 限流 key（如 `sms:phone:<normalized>:60s`）
 * @param limit 窗口内最大次数
 * @param windowSeconds 窗口大小（秒）
 * @returns RateLimitResult
 *
 * 用法：
 *   const r = await rateLimit('sms:phone:<normalized>:60s', 1, 60);
 *   if (!r.allowed) throw new Error(`SMS_RATE_LIMIT retryAfter=${r.retryAfter}`);
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const k = `ratelimit:${key}`;
  const nowMs = Date.now();
  const windowMs = windowSeconds * 1000;

  const result = await redis.eval(
    SLIDING_WINDOW_SCRIPT,
    1,
    k,
    nowMs,
    windowMs,
    limit,
    windowSeconds,
  );

  // Lua 返回 [allowed, current, limit, retryAfter]
  const r = result as number[];
  return {
    allowed: r[0] === 1,
    current: r[1],
    limit: r[2],
    retryAfter: r[3],
  };
}

/**
 * SMS 限流策略组合（契约 v0.2 §4.3）
 *
 * 触发任意一条 -> 拒绝
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
