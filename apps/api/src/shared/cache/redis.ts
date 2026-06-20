/**
 * Redis 封装（ioredis 单例，lazy 初始化）
 *
 * 决策依据：CLAUDE.md §技术栈（Redis 7 + BullMQ）
 * 用途：
 *   - JWT 黑名单（v0.3 决策 F）
 *   - SMS/邮件限流计数器
 *   - orderNo 序号生成（INCR order:seq:{date}:{whCode}）
 *   - BullMQ 队列（W2-W5 接入）
 *   - 用户会话（可选，dev 用）
 *
 * 设计：lazy 初始化 — 模块加载不抛错，第一次访问 redis 时才创建连接
 *      这样 prisma migrate 等不需要 redis 的子命令也能 import 此模块
 *
 * 环境变量：
 *   REDIS_URL=redis://localhost:6379
 */
import IORedis, { type Redis } from 'ioredis';

const globalForRedis = globalThis as unknown as { __meimartRedis?: Redis };

function createRedis(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL env var is required when redis is accessed');
  }
  return new IORedis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'meimart:',
  });
}

/**
 * Redis 单例 getter（lazy）
 *
 * 用法：
 *   import { redis } from '@/shared/cache';
 *   await redis.set('k', 'v');
 *
 * 模块加载时不会创建连接，首次访问 redis 属性时才创建。
 */
export const redis: Redis = new Proxy({} as Redis, {
  get(_target, prop) {
    if (!globalForRedis.__meimartRedis) {
      globalForRedis.__meimartRedis = createRedis();
    }
    const value = (globalForRedis.__meimartRedis as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === 'function' ? value.bind(globalForRedis.__meimartRedis) : value;
  },
});

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
