/**
 * Refresh Token Family（W7-ext-H 修复 v1.2）
 *
 * 设计依据：RFC 6749 §10.4 + OAuth 2.0 Token Family 最佳实践
 *
 * Redis 结构（3 个 key，独立于 registrationTicket）：
 *   refresh:session:{jti}  -> JSON {familyId, userId, status, deviceType, createdAt, expiresAt, usedAt?}
 *   refresh:family:{familyId} -> SET of jti（撤销时遍历整族）
 *   refresh:user:{userId}     -> SET of familyId（密码重置撤销该用户所有会话）
 *
 * status 流转：
 *   active -> used（首次刷新消费） -> 新 jti（同 familyId）active
 *   used 再次使用 -> REPLAY -> 撤销整个 family（所有 session revoked）
 *   revoked -> 拒绝
 *
 * 并发安全：consumeRefreshSession 用 Lua 原子执行，并发刷新同一旧 jti
 *   只一个返回 OK，另一个返回 REPLAY 触发 family 撤销。
 */
import { redis } from './redis';
import { logger } from '../logger/logger';

export type RefreshSessionStatus = 'active' | 'used' | 'revoked';

export interface RefreshSession {
  familyId: string;
  userId: string;
  status: RefreshSessionStatus;
  deviceType: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export type ConsumeResult =
  | { status: 'OK'; session: RefreshSession }
  | { status: 'INVALID' }
  | { status: 'EXPIRED' }
  | { status: 'REVOKED' }
  | { status: 'REPLAY'; familyId: string };

/**
 * 原子消费 Lua 脚本
 *
 * 逻辑：
 *   1. GET session，不存在 -> INVALID
 *   2. expiresAt < now -> EXPIRED
 *   3. status=revoked -> REVOKED
 *   4. status=used -> REPLAY + 撤销整个 family（遍历 refresh:family:{familyId}，全部 revoked）
 *   5. status=active -> 标记 used + usedAt -> 返回 OK + session
 *
 * 原子性：Lua 单线程执行，并发消费同一 jti 只一个走到 step 5，另一个走到 step 4（REPLAY）。
 */
const CONSUME_SCRIPT = `
local sessionKey = KEYS[1]
local now = tonumber(ARGV[1])

local data = redis.call('GET', sessionKey)
if not data then return cjson.encode({status='INVALID'}) end

local session = cjson.decode(data)
if tonumber(session.expiresAt) < now then
  return cjson.encode({status='EXPIRED'})
end

if session.status == 'revoked' then
  return cjson.encode({status='REVOKED'})
end

if session.status == 'used' then
  -- 重放！撤销整个 family
  local familyKey = 'refresh:family:' .. session.familyId
  local jtis = redis.call('SMEMBERS', familyKey)
  for _, j in ipairs(jtis) do
    local s = redis.call('GET', 'refresh:session:' .. j)
    if s then
      local d = cjson.decode(s)
      d.status = 'revoked'
      redis.call('SET', 'refresh:session:' .. j, cjson.encode(d))
    end
  end
  return cjson.encode({status='REPLAY', familyId=session.familyId})
end

-- active -> used
session.status = 'used'
session.usedAt = now
redis.call('SET', sessionKey, cjson.encode(session))
return cjson.encode({status='OK', session=session})
`;

/**
 * 创建 refresh session（登录 / 刷新签新 pair 时调）
 */
export async function createRefreshSession(params: {
  jti: string;
  familyId: string;
  userId: string;
  deviceType: string;
  expiresAt: number; // 毫秒时间戳
}): Promise<void> {
  const { jti, familyId, userId, deviceType, expiresAt } = params;
  const now = Date.now();
  const ttlSec = Math.max(1, Math.floor((expiresAt - now) / 1000));

  const session: RefreshSession = {
    familyId,
    userId,
    status: 'active',
    deviceType,
    createdAt: now,
    expiresAt,
  };

  const pipeline = redis.pipeline();
  pipeline.set(`refresh:session:${jti}`, JSON.stringify(session), 'EX', ttlSec);
  pipeline.sadd(`refresh:family:${familyId}`, jti);
  pipeline.expire(`refresh:family:${familyId}`, ttlSec);
  pipeline.sadd(`refresh:user:${userId}`, familyId);
  pipeline.expire(`refresh:user:${userId}`, ttlSec);
  await pipeline.exec();
}

/**
 * 原子消费 refresh session（刷新 token 时调）
 *
 * 返回：
 *   OK + session -> 可签发新 pair（同 familyId）
 *   INVALID/EXPIRED/REVOKED -> 拒绝（token 无效/过期/已撤销）
 *   REPLAY + familyId -> 重放！family 已被撤销，拒绝 + 记日志
 */
export async function consumeRefreshSession(jti: string): Promise<ConsumeResult> {
  const result = await redis.eval(CONSUME_SCRIPT, 1, `refresh:session:${jti}`, Date.now());
  const parsed = JSON.parse(result as string) as ConsumeResult;

  if (parsed.status === 'REPLAY') {
    logger.warn({
      msg: 'REFRESH_TOKEN_REPLAY_DETECTED',
      jti,
      familyId: parsed.familyId,
      action: 'family_revoked',
    });
  }

  return parsed;
}

/**
 * 撤销整个 family（logout 时调）
 *
 * 遍历 refresh:family:{familyId} 所有 jti，标记 revoked。
 */
export async function revokeFamily(familyId: string): Promise<void> {
  const familyKey = `refresh:family:${familyId}`;
  const jtis = await redis.smembers(familyKey);
  for (const jti of jtis) {
    const data = await redis.get(`refresh:session:${jti}`);
    if (data) {
      const session = JSON.parse(data) as RefreshSession;
      if (session.status !== 'revoked') {
        session.status = 'revoked';
        const ttl = await redis.ttl(`refresh:session:${jti}`);
        if (ttl > 0) {
          await redis.set(`refresh:session:${jti}`, JSON.stringify(session), 'EX', ttl);
        } else {
          await redis.set(`refresh:session:${jti}`, JSON.stringify(session));
        }
      }
    }
  }
  logger.info({ msg: 'REFRESH_FAMILY_REVOKED', familyId, jtiCount: jtis.length });
}

/**
 * 撤销该用户所有 family（密码重置 / 改密 / 封禁时调）
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  const userKey = `refresh:user:${userId}`;
  const familyIds = await redis.smembers(userKey);
  for (const familyId of familyIds) {
    await revokeFamily(familyId);
  }
  logger.info({
    msg: 'REFRESH_USER_SESSIONS_REVOKED',
    userId,
    familyCount: familyIds.length,
  });
}

/**
 * 检查 session 是否有效（轻量检查，不消费，用于 verifyRefreshToken 的快速拒绝）
 *
 * 注意：此函数只读，不原子。真正的消费用 consumeRefreshSession。
 */
export async function isSessionValid(jti: string): Promise<boolean> {
  const data = await redis.get(`refresh:session:${jti}`);
  if (!data) return false;
  const session = JSON.parse(data) as RefreshSession;
  if (session.status === 'revoked') return false;
  if (session.expiresAt < Date.now()) return false;
  return true;
}

/**
 * 读取 session（只读，logout 拿 familyId 用）
 */
export async function getRefreshSession(jti: string): Promise<RefreshSession | null> {
  const data = await redis.get(`refresh:session:${jti}`);
  if (!data) return null;
  return JSON.parse(data) as RefreshSession;
}
