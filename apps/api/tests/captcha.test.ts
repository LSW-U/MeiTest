/**
 * 图形验证码闸门单测（批A2-2 · 决策7/8）
 *
 * 覆盖（任务书 ≥5 例）：
 *   - 票据一次性（GETDEL 消费即焚，二次用同票据失败）
 *   - 过期/未知 captchaId
 *   - 错答
 *   - 正答消费
 *   - 开关放行（SMS_CAPTCHA_REQUIRED=false / dev 默认关）
 *   - 缺参
 *   - 大小写不敏感
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { set: vi.fn(), eval: vi.fn() },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { HttpException } from '@nestjs/common';
import {
  issueCaptcha,
  assertCaptchaPassed,
  isCaptchaRequired,
  E_CAPTCHA_001,
} from '../src/infrastructure/otp/captcha';
import { logger } from '../src/shared/logger/logger';

const warnSpy = logger.warn as ReturnType<typeof vi.fn>;

describe('isCaptchaRequired（开关）', () => {
  afterEach(() => {
    delete process.env.SMS_CAPTCHA_REQUIRED;
    delete process.env.NODE_ENV;
  });

  it('dev（无 NODE_ENV）默认 false 放行（本地/E2E 不被闸）', () => {
    delete process.env.SMS_CAPTCHA_REQUIRED;
    delete process.env.NODE_ENV;
    expect(isCaptchaRequired()).toBe(false);
  });

  it('production 默认 true（防刷优先）', () => {
    delete process.env.SMS_CAPTCHA_REQUIRED;
    process.env.NODE_ENV = 'production';
    expect(isCaptchaRequired()).toBe(true);
  });

  it('env 显式覆盖：dev 强制 true / prod 显式 false 均生效', () => {
    process.env.SMS_CAPTCHA_REQUIRED = 'true';
    delete process.env.NODE_ENV;
    expect(isCaptchaRequired()).toBe(true);

    process.env.SMS_CAPTCHA_REQUIRED = 'false';
    process.env.NODE_ENV = 'production';
    expect(isCaptchaRequired()).toBe(false);
  });
});

describe('assertCaptchaPassed（消费/校验）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'production'; // 默认闸门开
    process.env.SMS_CAPTCHA_REQUIRED = 'true';
  });

  afterEach(() => {
    delete process.env.SMS_CAPTCHA_REQUIRED;
    delete process.env.NODE_ENV;
  });

  it('正答 → 放行不抛；GETDEL Lua 一次性消费（captcha:{id}）', async () => {
    mockRedis.eval.mockResolvedValue('abcd');
    await expect(
      assertCaptchaPassed({ captchaId: 'cid-1', captchaText: 'ABCD' }),
    ).resolves.toBeUndefined();
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('GETDEL'),
      1,
      'captcha:cid-1',
    );
  });

  it('票据一次性：第二次消费返回 nil → 400 E-CAPTCHA-001（即使答案也对）', async () => {
    mockRedis.eval
      .mockResolvedValueOnce('abcd') // 第一次：消费成功
      .mockResolvedValueOnce(null); // 第二次：票据已焚
    await expect(
      assertCaptchaPassed({ captchaId: 'cid-1', captchaText: 'abcd' }),
    ).resolves.toBeUndefined();
    await expect(
      assertCaptchaPassed({ captchaId: 'cid-1', captchaText: 'abcd' }),
    ).rejects.toMatchObject({ status: 400, response: { code: E_CAPTCHA_001 } });
  });

  it('错答 → 400 E-CAPTCHA-001 + warn（票据同样已焚，不外泄错答/过期区别给客户端语义）', async () => {
    mockRedis.eval.mockResolvedValue('abcd');
    try {
      await assertCaptchaPassed({ captchaId: 'cid-2', captchaText: 'zzzz' });
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const he = e as HttpException;
      expect(he.getStatus()).toBe(400);
      expect((he.getResponse() as { code: string }).code).toBe(E_CAPTCHA_001);
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'CAPTCHA_VERIFY_FAILED', reason: 'wrong_answer' }),
    );
  });

  it('过期/未知 captchaId（GETDEL 返回 nil）→ 400 E-CAPTCHA-001 + reason expired_or_unknown', async () => {
    mockRedis.eval.mockResolvedValue(null);
    await expect(
      assertCaptchaPassed({ captchaId: 'ghost', captchaText: 'abcd' }),
    ).rejects.toMatchObject({ status: 400, response: { code: E_CAPTCHA_001 } });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'CAPTCHA_VERIFY_FAILED', reason: 'expired_or_unknown' }),
    );
  });

  it('缺参（无 captchaId / 无 captchaText）→ 400 E-CAPTCHA-001，不碰 Redis', async () => {
    await expect(assertCaptchaPassed({})).rejects.toMatchObject({
      status: 400,
      response: { code: E_CAPTCHA_001 },
    });
    await expect(assertCaptchaPassed({ captchaId: 'cid' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(assertCaptchaPassed({ captchaText: 'abcd' })).rejects.toMatchObject({
      status: 400,
    });
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('开关关（SMS_CAPTCHA_REQUIRED=false）→ 直接放行，不查 Redis 不消费票据', async () => {
    process.env.SMS_CAPTCHA_REQUIRED = 'false';
    await expect(assertCaptchaPassed({})).resolves.toBeUndefined();
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });
});

describe('issueCaptcha（签发）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('返回 captchaId + svg，Redis 存答案（小写，TTL 60s）', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const result = await issueCaptcha();

    expect(result.captchaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.svg).toContain('<svg');
    expect(result.expireIn).toBe(60);
    const [key, value, , ttl] = mockRedis.set.mock.calls[0] as [string, string, string, number];
    expect(key).toBe(`captcha:${result.captchaId}`);
    expect(value).toMatch(/^[a-z0-9]{4}$/); // 小写答案 4 位（ignoreChars 排除易混淆，svg-captcha text 原文可能混大小写，存前统一 lowercase）
    expect(ttl).toBe(60);
  });
});
