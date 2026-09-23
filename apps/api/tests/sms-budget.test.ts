/**
 * SMS 全局日预算熔断单测（批A2-1 · T3 日预算维）
 *
 * 覆盖：
 *   - 放行：count <= limit 不抛、记账 INCR + 首次 EXPIRE
 *   - 触发：count > limit → 503 E-SMS-001 + warn 分桶 budget_exceeded
 *   - env SMS_DAILY_BUDGET_LIMIT 可配（合法/非法/未配置回默认 200）
 *   - 跨日重置：键含 UTC 日期（翻页自然新键）
 *   - Redis 异常降级放行（fail-open，熔断器故障不扩大爆炸半径）
 *   - 键位：sms:budget:{UTC日期}
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { eval: vi.fn() },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { HttpException } from '@nestjs/common';
import {
  assertSmsDailyBudget,
  smsBudgetKey,
  todayUtc,
  readSmsDailyBudgetLimit,
  DEFAULT_SMS_DAILY_BUDGET,
} from '../src/infrastructure/otp/sms-budget';
import { logger } from '../src/shared/logger/logger';

const warnSpy = logger.warn as ReturnType<typeof vi.fn>;

describe('smsBudgetKey / todayUtc（键位设计）', () => {
  it('键 = sms:budget:{UTC日期}，跨日自然翻新键（跨日重置无需清理逻辑）', () => {
    expect(smsBudgetKey('2026-09-23')).toBe('sms:budget:2026-09-23');
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('readSmsDailyBudgetLimit（env 可配）', () => {
  afterEach(() => delete process.env.SMS_DAILY_BUDGET_LIMIT);

  it('未配置 → 默认 200', () => {
    delete process.env.SMS_DAILY_BUDGET_LIMIT;
    expect(readSmsDailyBudgetLimit()).toBe(DEFAULT_SMS_DAILY_BUDGET);
  });

  it('合法配置生效', () => {
    process.env.SMS_DAILY_BUDGET_LIMIT = '500';
    expect(readSmsDailyBudgetLimit()).toBe(500);
  });

  it('非法值（0/负数/非数字）→ 回默认 200（熔断不失效）', () => {
    for (const bad of ['0', '-5', 'abc']) {
      process.env.SMS_DAILY_BUDGET_LIMIT = bad;
      expect(readSmsDailyBudgetLimit()).toBe(DEFAULT_SMS_DAILY_BUDGET);
    }
  });
});

describe('assertSmsDailyBudget（熔断触发/放行）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SMS_DAILY_BUDGET_LIMIT;
  });

  afterEach(() => delete process.env.SMS_DAILY_BUDGET_LIMIT);

  it('count <= limit → 放行不抛；Lua 原子 INCR+EXPIRE（批A2-1 P3-1 修复），key=当日键', async () => {
    mockRedis.eval.mockResolvedValue(1);
    await expect(assertSmsDailyBudget()).resolves.toBeUndefined();
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('INCR'"),
      1,
      smsBudgetKey(todayUtc()),
      2 * 24 * 3600,
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('再次发送（count=2）不再重复 EXPIRE（TTL 只在首笔设，Lua 内判断）', async () => {
    mockRedis.eval.mockResolvedValue(2);
    await expect(assertSmsDailyBudget()).resolves.toBeUndefined();
    expect(mockRedis.eval).toHaveBeenCalledTimes(1); // 单次 Lua 调用，无第二步
  });

  it('count > limit → 503 E-SMS-001 + warn 分桶 budget_exceeded（超限仍计数，偏保守）', async () => {
    process.env.SMS_DAILY_BUDGET_LIMIT = '200';
    mockRedis.eval.mockResolvedValue(201);

    try {
      await assertSmsDailyBudget();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const he = e as HttpException;
      expect(he.getStatus()).toBe(503);
      expect((he.getResponse() as { code: string }).code).toBe('E-SMS-001');
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'SMS_SEND_REFUSED',
        reason: 'budget_exceeded',
        count: 201,
        limit: 200,
      }),
    );
  });

  it('env 配置低阈值（如 3）→ 第 4 条即触发（可配性验证）', async () => {
    process.env.SMS_DAILY_BUDGET_LIMIT = '3';
    mockRedis.eval.mockResolvedValue(4);
    await expect(assertSmsDailyBudget()).rejects.toMatchObject({
      status: 503,
    });
  });

  it('Redis 异常 → 降级放行不抛（fail-open，熔断器自身故障不阻断业务）', async () => {
    mockRedis.eval.mockRejectedValue(new Error('redis down'));
    await expect(assertSmsDailyBudget()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: 'SMS_BUDGET_CHECK_DEGRADED',
        reason: 'redis_error',
      }),
    );
  });
});
