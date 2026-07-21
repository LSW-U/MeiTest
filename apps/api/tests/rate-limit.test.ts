/**
 * rate-limit.ts 单测（W7-ext-H v1.2）
 *
 * 测 rateLimit 函数解析 Lua 返回的逻辑。Lua 脚本本身的原子性靠代码审查 + e2e。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { eval: vi.fn() },
}));

vi.mock('../src/shared/cache/redis', () => ({ redis: mockRedis }));

import { rateLimit, checkSmsRateLimit } from '../src/shared/cache/rate-limit';

describe('rateLimit（滑动窗口 v1.2）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('limit 内 -> allowed=true', async () => {
    mockRedis.eval.mockResolvedValue([1, 1, 5, 0]);
    const r = await rateLimit('test', 5, 60);
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(1);
    expect(r.limit).toBe(5);
    expect(r.retryAfter).toBe(0);
  });

  it('超限 -> allowed=false + retryAfter', async () => {
    mockRedis.eval.mockResolvedValue([0, 5, 5, 30]);
    const r = await rateLimit('test', 5, 60);
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBe(30);
  });

  it('调 redis.eval 传滑动窗口参数', async () => {
    mockRedis.eval.mockResolvedValue([1, 1, 1, 0]);
    await rateLimit('sms:phone:123', 1, 60);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String), // Lua 脚本
      1, // numkeys
      'ratelimit:sms:phone:123', // key
      expect.any(Number), // nowMs
      60000, // windowMs
      1, // limit
      60, // windowSec
    );
  });
});

describe('checkSmsRateLimit（4 级组合）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('全过 -> 返回第一个（60s 状态）', async () => {
    mockRedis.eval.mockResolvedValue([1, 0, 1, 0]);
    const r = await checkSmsRateLimit('+67012345678', '127.0.0.1');
    expect(r.allowed).toBe(true);
  });

  it('60s 超限 -> 返回第一个超限的', async () => {
    // 4 级：60s(1,60) / 1h(5,3600) / 24h(10,86400) / ip(20,3600)
    mockRedis.eval
      .mockResolvedValueOnce([0, 1, 1, 45]) // 60s 超限
      .mockResolvedValueOnce([1, 0, 5, 0]) // 1h ok
      .mockResolvedValueOnce([1, 0, 10, 0]) // 24h ok
      .mockResolvedValueOnce([1, 0, 20, 0]); // ip ok
    const r = await checkSmsRateLimit('+67012345678', '127.0.0.1');
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBe(45);
  });

  it('IP 超限 -> 返回 IP 维度', async () => {
    mockRedis.eval
      .mockResolvedValueOnce([1, 0, 1, 0]) // 60s ok
      .mockResolvedValueOnce([1, 0, 5, 0]) // 1h ok
      .mockResolvedValueOnce([1, 0, 10, 0]) // 24h ok
      .mockResolvedValueOnce([0, 20, 20, 1800]); // ip 超限
    const r = await checkSmsRateLimit('+67012345678', '127.0.0.1');
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBe(1800);
  });
});
