/**
 * SMS 全局日预算熔断（批A2-1 · T3 后端频控四维之「日预算」维）
 *
 * 决策依据：方案v1-SMS-OTP真实接入-20260918.md §0 决策表 #3
 *   - 首月预算 $500（~1300 条），日熔断默认 200 条（TL 单价 $0.379 全场最贵，风控前置）
 *   - env SMS_DAILY_BUDGET_LIMIT 可配
 *
 * 实现（参照 notify 侧 sms:notify:daily 范式，infrastructure/notify/sms.strategy.ts:129-144）：
 *   - Redis INCR `sms:budget:{UTC 日期}`，首次 EXPIRE 2 天（跨 UTC 日余量，避免临界日堆积）
 *   - count > limit → 拒发 503 E-SMS-001 + warn 分桶 budget_exceeded（R17 拒发计数同族）
 *   - 超限后仍计数（偏保守，防突发放大——与 notify 日配额同款取舍）
 *   - 只在真实发送路径调用（stub 不计数不发钱），见 sms.strategy.sendCode
 *
 * 跨日重置：键含 UTC 日期，自然日翻页即新键，无需清理逻辑。
 */
import { redis } from '../../shared/cache';
import { logger } from '../../shared/logger/logger';
import { smsUnavailableException } from './sms.strategy';

/** 日预算默认值（SMS_DAILY_BUDGET_LIMIT 未配置或非法时兜底，熔断不失效） */
export const DEFAULT_SMS_DAILY_BUDGET = 200;

/** 预算键 TTL：2 天（跨 UTC 日余量，同 notify 日配额） */
const BUDGET_KEY_TTL_SECONDS = 2 * 24 * 3600;

/** 日预算 Redis 键（命名空间 sms:budget:*） */
export function smsBudgetKey(date: string): string {
  return `sms:budget:${date}`;
}

/** 当日 UTC 日期（预算按自然日，UTC 与云厂商账单日对齐，不追 Asia/Dili 业务日） */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 日预算上限（env 每次现读，改配置下一发即生效；非法值回默认） */
export function readSmsDailyBudgetLimit(): number {
  const n = Number(process.env.SMS_DAILY_BUDGET_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SMS_DAILY_BUDGET;
}

/**
 * 日预算熔断检查（真实发送前调用；stub 不调用）
 *
 * INCR+EXPIRE 走 Lua 一次原子化（批A2-1 审查 P3-1 顺手修复：原两步间进程崩溃会留
 * 无 TTL 的当日键——键含 UTC 日期兜底只是泄漏不阻塞，原子化后连泄漏也消除）。
 * 超限拒发 503 E-SMS-001（R17 分桶 budget_exceeded）。
 * Redis 异常不阻断发送（熔断器自身故障不应扩大爆炸半径，降级放行 + warn）。
 */
const BUDGET_INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;

export async function assertSmsDailyBudget(): Promise<void> {
  const key = smsBudgetKey(todayUtc());
  const limit = readSmsDailyBudgetLimit();
  let count: number;
  try {
    count = (await redis.eval(
      BUDGET_INCR_SCRIPT,
      1,
      key,
      BUDGET_KEY_TTL_SECONDS,
    )) as number;
  } catch (e) {
    logger.warn({
      msg: 'SMS_BUDGET_CHECK_DEGRADED',
      reason: 'redis_error',
      error: (e as Error).message,
      note: 'budget check redis error; allowing send (fail-open)',
    });
    return;
  }
  if (count > limit) {
    logger.warn({
      msg: 'SMS_SEND_REFUSED',
      reason: 'budget_exceeded',
      count,
      limit,
      note: 'daily SMS budget exceeded; OTP send refused with 503 E-SMS-001',
    });
    throw smsUnavailableException(
      `daily SMS budget exceeded (${count}/${limit})`,
    );
  }
}
