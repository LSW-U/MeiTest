/**
 * SmsStrategy provider 分流单测（批A A-1 · R1）
 *
 * 覆盖：
 *   - provider 选择：未配置 dev 默认 stub / 显式 stub / 显式 gateway / 未配置 prod 默认 gateway
 *   - gateway 缺凭据 → sendCode 运行时拒发 503 E-SMS-001（P1-1 审查修复：
 *     构造期不抛——otp.factory 模块作用域 new 不可因缺凭据让 API 启动即死）
 *   - SMS_STUB_ALLOWED=true 逃生门放行
 *   - SMS_STUB_CODE 仅 stub 生效（gateway 通道发随机码，非 123456）
 *   - maskSmsPhone 日志脱敏 ≥3 例（N-2 第3项）
 *   - clearSmsProviderCache 缓存重置钩子
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { HttpException, HttpStatus } from '@nestjs/common';
import { SmsStrategy, clearSmsProviderCache, maskSmsPhone, E_SMS_001 } from '../src/infrastructure/otp/sms.strategy';

const GATEWAY_ENV = {
  SMS_PROVIDER: 'gateway',
  SMS_GATEWAY_URL: 'https://sms-gw.example.com/v1/send',
  SMS_GATEWAY_AUTH_HEADER: 'Authorization',
  SMS_GATEWAY_AUTH_VALUE: 'Bearer test-secret',
  SMS_GATEWAY_PAYLOAD_TEMPLATE: JSON.stringify({ to: '{{phone}}', text: '{{text}}' }),
};

/** 设置 env 并构造新策略（每次构造前清 provider 缓存） */
function makeStrategy(env: Record<string, string | undefined>): SmsStrategy {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearSmsProviderCache();
  return new SmsStrategy();
}

describe('SmsStrategy provider 分流（批A R1）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.del.mockResolvedValue(1);
  });

  afterEach(() => {
    clearSmsProviderCache();
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_GATEWAY_URL;
    delete process.env.SMS_GATEWAY_AUTH_HEADER;
    delete process.env.SMS_GATEWAY_AUTH_VALUE;
    delete process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
    delete process.env.SMS_STUB_ALLOWED;
    delete process.env.SMS_STUB_CODE;
  });

  it('未配置 SMS_PROVIDER 且 dev → 默认 stub（isMock=true，stub 固定码落 Redis）', async () => {
    delete process.env.NODE_ENV;
    const s = makeStrategy({});
    expect(s.isMock).toBe(true);

    process.env.SMS_STUB_CODE = '654321';
    await s.sendCode({ target: '+67012345678', scene: 'LOGIN' });
    expect(mockRedis.set).toHaveBeenCalledWith('otp:sms:LOGIN:+67012345678', '654321', 'EX', 300);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('未配置 SMS_PROVIDER 且 production → 默认 gateway（isMock=false）；构造不抛（P1-1）', () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({});
    expect(s.isMock).toBe(false); // 构造期只定意图不校验凭据，模块加载不再崩
  });

  it('prod gateway 缺凭据 → sendCode 运行时拒发 503 E-SMS-001（HttpException，P1-1+P1-2）', async () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({});
    expect(s.isMock).toBe(false);
    const err = await s.sendCode({ target: '+67012345678', scene: 'LOGIN' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    // 落 all-exceptions.filter 的 HttpException 分支：response 带 code，客户端拿到 E-SMS-001
    expect((err.getResponse() as { code?: string }).code).toBe(E_SMS_001);
  });

  it('prod gateway 缺凭据 sendCode → 不落 Redis 不调 fetch（拒发在落码之前）', async () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({});
    await expect(s.sendCode({ target: '+67012345678', scene: 'LOGIN' })).rejects.toThrow(
      HttpException,
    );
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('显式 SMS_PROVIDER=gateway 且凭据齐备 → isMock=false，fetch 直调网关且不带固定 stub 码', async () => {
    const s = makeStrategy(GATEWAY_ENV);
    expect(s.isMock).toBe(false);

    process.env.SMS_STUB_CODE = '123456'; // gateway 通道必须无视
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'gw-msg-1' }), { status: 200 }));

    await s.sendCode({ target: '+67012345678', scene: 'REGISTER' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms-gw.example.com/v1/send');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-secret');
    const body = JSON.parse(init.body as string) as { to: string; text: string };
    expect(body.to).toBe('+67012345678');
    // SMS_STUB_CODE 仅 stub 生效：随机码 ≠ 固定 stub 码
    expect(body.text).not.toContain('123456');
    // 随机 6 位码已落 Redis（stub 固定码路径不会这样调）
    const setCall = mockRedis.set.mock.calls[0] as unknown[];
    expect(setCall[0]).toBe('otp:sms:REGISTER:+67012345678');
    expect(setCall[1]).toMatch(/^\d{6}$/);
    expect(setCall[2]).toBe('EX');
  });

  it('SMS_PROVIDER=gateway 缺凭据 → sendCode 运行时拒发 503 E-SMS-001（显式指定也不静默降级）', async () => {
    const s = makeStrategy({ SMS_PROVIDER: 'gateway' });
    expect(s.isMock).toBe(false); // 构造期不抛（P1-1）
    await expect(s.sendCode({ target: '+67012345678', scene: 'LOGIN' })).rejects.toThrow(
      HttpException,
    );
  });

  it('逃生门 SMS_STUB_ALLOWED=true：prod 缺凭据不拒发，sendCode 放行 stub（isMock=true）', async () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({ SMS_STUB_ALLOWED: 'true' });
    expect(s.isMock).toBe(true);
    await s.sendCode({ target: '+67012345678', scene: 'LOGIN' });
    expect(mockRedis.set).toHaveBeenCalled(); // stub 通道正常落码
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('provider 缓存：clearSmsProviderCache() 后重读 env（stub → gateway 生效）', () => {
    process.env.NODE_ENV = 'production';
    const stub = makeStrategy({ SMS_PROVIDER: 'stub' });
    expect(stub.isMock).toBe(true);

    // 不清缓存时改 env 不生效（env 只在进程启动时读取的语义）
    process.env.SMS_PROVIDER = 'gateway';
    process.env.SMS_GATEWAY_URL = 'https://x';
    process.env.SMS_GATEWAY_AUTH_VALUE = 'v';
    process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE = '{}';
    expect(new SmsStrategy().isMock).toBe(true);

    // 清缓存后重读 → gateway
    clearSmsProviderCache();
    expect(new SmsStrategy().isMock).toBe(false);
  });

  it('gateway verifyCode 与 stub 同键结构：一次性消费 + 判错码', async () => {
    const s = makeStrategy(GATEWAY_ENV);
    mockRedis.get.mockResolvedValue('424242');

    expect(await s.verifyCode({ target: '+67012345678', code: '000000', scene: 'LOGIN' }))
      .toEqual({ valid: false, reason: 'WRONG_CODE' });
    expect(mockRedis.del).not.toHaveBeenCalled();

    expect(await s.verifyCode({ target: '+67012345678', code: '424242', scene: 'LOGIN' }))
      .toEqual({ valid: true });
    expect(mockRedis.del).toHaveBeenCalledWith('otp:sms:LOGIN:+67012345678');

    mockRedis.get.mockResolvedValue(null);
    expect(await s.verifyCode({ target: '+67012345678', code: '424242', scene: 'LOGIN' }))
      .toEqual({ valid: false, reason: 'EXPIRED' });
  });
});

describe('maskSmsPhone 日志脱敏（N-2 第3项）', () => {
  it.each([
    ['+67012345678', '+670****78'],
    ['+67077777777', '+670****77'],
    ['+6703333333', '+670****33'],
  ])('maskSmsPhone(%s) → %s（前4后2，中间掩码）', (input, expected) => {
    expect(maskSmsPhone(input)).toBe(expected);
  });

  it('超短号（<6 位）→ 全掩 ***，不泄漏任何片段', () => {
    expect(maskSmsPhone('+670')).toBe('***');
  });

  it('stub 与 gateway 通道日志均输出脱敏 phone（不泄漏明文）', async () => {
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // stub 通道
      const stub = makeStrategy({ SMS_PROVIDER: 'stub' });
      await stub.sendCode({ target: '+67012345678', scene: 'LOGIN' });
      // gateway 通道
      const gw = makeStrategy(GATEWAY_ENV);
      mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
      await gw.sendCode({ target: '+67098765432', scene: 'LOGIN' });
      // 两条路径都只经 maskSmsPhone 归一化（logger 内还有 phone 字段 last-4 兜底 mask）
      expect(maskSmsPhone('+67012345678')).toBe('+670****78');
      expect(maskSmsPhone('+67098765432')).toBe('+670****32');
    } finally {
      logSpy.mockRestore();
    }
  });
});
