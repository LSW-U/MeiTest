/**
 * 用户会话缓存（可选，dev 使用，prod 可省略走数据库）
 *
 * 决策依据：CLAUDE.md §技术栈（Redis 用于会话/JWT 黑名单）
 *
 * MVP 阶段：user 主信息从 DB 读，Redis 只缓存高频字段（如 lastDeviceType）
 * 不缓存敏感信息（password hash / phone 全号）
 */
import { redis } from './redis';

const SESSION_PREFIX = 'session:';
const SESSION_TTL = 30 * 24 * 60 * 60; // 30 天

export async function cacheUserSession(
  userId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await redis.set(`${SESSION_PREFIX}${userId}`, JSON.stringify(data), 'EX', SESSION_TTL);
}

export async function getUserSession(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const raw = await redis.get(`${SESSION_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function clearUserSession(userId: string): Promise<void> {
  await redis.del(`${SESSION_PREFIX}${userId}`);
}
