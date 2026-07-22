/**
 * Registration Ticket（W7-ext-H 统一手机号入口）
 *
 * 11 条决策落地：
 * 1. Redis only，不建 DB 表，不进 RefreshSession
 * 2. 5min，只能 COMPLETE_BUYER_REGISTRATION，不当 access token
 * 3. crypto.randomBytes(32) 不透明随机，Redis 存 SHA256 哈希（不存明文）
 * 4. 绑定标准化手机号 + challengeId + purpose + verifiedAt + 可选 deviceId
 * 5. GETDEL 原子消费（并发只能一个成功）
 * 6. 消费后 DB 事务失败需重新验证（调用方处理 410）
 *
 * 独立于 RefreshSession（两套 Redis key 前缀：register: vs refresh:）
 */
import { randomBytes, createHash } from 'crypto';
import { redis } from './redis';

export interface RegistrationTicketData {
  phone: string;
  challengeId: string;
  purpose: 'COMPLETE_BUYER_REGISTRATION';
  verifiedAt: number;
  deviceId?: string | null;
  expiresAt: number;
}

export type ConsumeTicketResult =
  | { status: 'OK'; data: RegistrationTicketData }
  | { status: 'INVALID_OR_USED' };

const TICKET_TTL_SECONDS = 300; // 5 分钟
const KEY_PREFIX = 'register:ticket:';

/** GETDEL 原子消费 Lua 脚本（决策 5） */
const CONSUME_SCRIPT = `
local data = redis.call('GETDEL', KEYS[1])
if not data then return nil end
return data
`;

/**
 * 创建 registration ticket（verify 端点未注册分流时调）
 *
 * @returns ticketPlain 明文（返回给客户端），Redis 只存 SHA256 哈希（决策 3）
 */
export async function createTicket(params: {
  phone: string;
  challengeId: string;
  deviceId?: string;
}): Promise<string> {
  const ticketPlain = randomBytes(32).toString('base64url');
  const ticketHash = createHash('sha256').update(ticketPlain).digest('hex');
  const now = Date.now();

  const data: RegistrationTicketData = {
    phone: params.phone,
    challengeId: params.challengeId,
    purpose: 'COMPLETE_BUYER_REGISTRATION',
    verifiedAt: now,
    deviceId: params.deviceId ?? null,
    expiresAt: now + TICKET_TTL_SECONDS * 1000,
  };

  await redis.set(`${KEY_PREFIX}${ticketHash}`, JSON.stringify(data), 'EX', TICKET_TTL_SECONDS);
  return ticketPlain;
}

/**
 * 原子消费 registration ticket（complete 端点调）
 *
 * GETDEL 原子：并发请求只能一个返回 OK，其他 INVALID_OR_USED。
 *
 * @returns OK + ticketData / INVALID_OR_USED（已用/不存在/过期）
 */
export async function consumeTicket(ticketPlain: string): Promise<ConsumeTicketResult> {
  const ticketHash = createHash('sha256').update(ticketPlain).digest('hex');
  const result = await redis.eval(CONSUME_SCRIPT, 1, `${KEY_PREFIX}${ticketHash}`);

  if (!result) {
    return { status: 'INVALID_OR_USED' };
  }

  const data = JSON.parse(result as string) as RegistrationTicketData;
  return { status: 'OK', data };
}
