/**
 * Redis 封装（ioredis 单例）
 *
 * 决策依据：CLAUDE.md §技术栈（Redis 7 + BullMQ）
 * 用途：
 *   - JWT 黑名单（v0.3 决策 F）
 *   - SMS/邮件限流计数器
 *   - orderNo 序号生成（INCR order:seq:{date}:{whCode}）
 *   - BullMQ 队列（W2-W5 接入）
 *   - 用户会话（可选，dev 用）
 *
 * 环境变量：
 *   REDIS_URL=redis://localhost:6379
 */
import IORedis, { type Redis } from 'ioredis';

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL env var is required');
  }
  return new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'meimart:',
  });
}

export const redis: Redis = globalForRedis.redis ?? createRedis();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}

/** 带 TTL 的 set */
export async function setWithTTL(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  await redis.set(key, value, 'EX', ttlSeconds);
}

/** key 是否存在（黑名单/限流场景用） */
export async function exists(key: string): Promise<boolean> {
  return (await redis.exists(key)) > 0;
}
