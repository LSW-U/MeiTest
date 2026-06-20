/**
 * JWT 黑名单（v0.3 决策 F：logout 必传 refreshToken，服务端立即失效）
 *
 * 决策依据：
 * - 契约 v0.3 决策 F + CLAUDE.md §Token 策略
 * - logout 时把 refresh token 的 jti 加入黑名单 blacklist:{jti}
 * - TTL = refresh token 剩余有效期（accessToken 自然过期）
 * - JWT verify 中间件先查黑名单是否存在
 */
import { redis } from './redis';

const BLACKLIST_PREFIX = 'blacklist:';

/**
 * 加入黑名单
 *
 * @param jti JWT ID
 * @param ttlSeconds 剩余有效期（秒），到时自动清理
 */
export async function blacklistJti(jti: string, ttlSeconds: number): Promise<void> {
  if (ttlSeconds <= 0) return; // 已过期，无需加
  await redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
}

/**
 * 检查 jti 是否在黑名单（已 logout）
 */
export async function isBlacklisted(jti: string): Promise<boolean> {
  const result = await redis.exists(`${BLACKLIST_PREFIX}${jti}`);
  return result > 0;
}

/**
 * 从黑名单移除（管理员强制恢复登录场景，MVP 不用）
 */
export async function unblacklist(jti: string): Promise<void> {
  await redis.del(`${BLACKLIST_PREFIX}${jti}`);
}
