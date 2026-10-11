/**
 * 安全专项收尾批1A 单测（方案v2-安全专项收尾-20261011 验收线 A1/A2/S1/S2）
 *
 * 覆盖三组：
 *   ① sms-startup-check：prod + SMS_STUB_ALLOWED=true → process.exit(1)（A1）
 *      （凭据缺失两路软告警不退进程回归对照）
 *   ② sms.strategy sendStub 白名单：prod 下白名单放行 / 非白名单拒绝双向（A2）
 *      （dev 不受 allowlist 影响回归对照；gateway/tencent 两条逃生门入口都汇入
 *      sendStub 单点，直接对 sendStub 行为断言即覆盖两路收口）
 *   ③ rate-limit.guard isE2eRateLimitBypass：prod 恒 false，dev/test 照常生效（A3）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── ① sms-startup-check ────────────────────────────────────────────────
// exit 断言用 vi.spyOn(process, 'exit')（仓内无先例，方案批1A 指定此法）：
// mock 为不抛错的 no-op，断言被调 + 参数 1；exit 后代码不可达，无需恢复执行流。
import { logger } from '../src/shared/logger/logger';
import {
  assertSmsStartupConfig,
} from '../src/shared/monitoring/sms-startup-check';
import {
  clearSmsProviderCache,
  SmsStrategy,
  smsUnavailableException,
  E_SMS_001,
} from '../src/infrastructure/otp/sms.strategy';
import { isE2eRateLimitBypass } from '../src/shared/guards/rate-limit.guard';

vi.mock('../src/shared/cache', () => ({
  redis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  },
}));

describe('assertSmsStartupConfig（批1A A1：prod stub 逃生门三态，方案v3 §九 #1）', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    clearSmsProviderCache();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__process_exit__');
    }) as never);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.NODE_ENV;
    delete process.env.SMS_STUB_ALLOWED;
    delete process.env.SMS_STUB_ALLOWLIST;
    delete process.env.SMS_PROVIDER;
  });

  it('三态① prod 无 flag → 不退进程', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'tencent';
    expect(() => assertSmsStartupConfig()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('三态② prod + flag + 无白名单（未配/空白/纯逗号）→ process.exit(1)，reason=STUB_ESCAPE_HATCH_ON', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    // 未配
    expect(() => assertSmsStartupConfig()).toThrow('__process_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STUB_ESCAPE_HATCH_ON' }),
    );
    // 空串
    exitSpy.mockClear();
    process.env.SMS_STUB_ALLOWLIST = '';
    expect(() => assertSmsStartupConfig()).toThrow('__process_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
    // 纯逗号+空格（trim 后全空）
    exitSpy.mockClear();
    process.env.SMS_STUB_ALLOWLIST = ' , ,, ';
    expect(() => assertSmsStartupConfig()).toThrow('__process_exit__');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('三态③ prod + flag + 非空白名单 → 放行启动（演示形态，warn 不退）', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_STUB_ALLOWLIST = ' +67071234567 ,+67072222222';
    expect(() => assertSmsStartupConfig()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'STUB_ESCAPE_HATCH_ALLOWLISTED' }),
    );
  });

  it('dev + SMS_STUB_ALLOWED=true → 不退进程（dev stub 是正常形态）', () => {
    process.env.NODE_ENV = 'development';
    process.env.SMS_STUB_ALLOWED = 'true';
    expect(() => assertSmsStartupConfig()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prod 未开逃生门 → 不退进程（回归：凭据缺失软告警语义不变）', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'tencent';
    expect(() => assertSmsStartupConfig()).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

// ─── ② sendStub 白名单（A2 双向） ───────────────────────────────────────
const PHONE_IN_LIST = '+67071234567';
const PHONE_NOT_IN_LIST = '+67079999999';

async function sendViaEscapeHatch(phone: string): Promise<unknown> {
  const strategy = new SmsStrategy();
  // 逃生门开（SMS_STUB_ALLOWED=true）时 isMock=true / tencent 分支都汇入 sendStub，
  // 直接走 sendCode 即覆盖两条入口的收口行为
  return strategy.sendCode({ target: phone, scene: 'LOGIN' } as never);
}

describe('SmsStrategy sendStub 白名单（批1A A2）', () => {
  beforeEach(() => {
    clearSmsProviderCache();
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.SMS_STUB_ALLOWED;
    delete process.env.SMS_STUB_ALLOWLIST;
    delete process.env.SMS_PROVIDER;
    vi.restoreAllMocks();
  });

  it('prod + 白名单命中 → 放行（发固定码，不抛）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'stub';
    process.env.SMS_STUB_ALLOWLIST = ` +67071111111, ${PHONE_IN_LIST} ,+67072222222`;
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await expect(sendViaEscapeHatch(PHONE_IN_LIST)).resolves.toMatchObject({
      expireIn: 300,
    });
  });

  it('prod + 非白名单 → 拒绝 503 E-SMS-001（reason=not_allowlisted）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'stub';
    process.env.SMS_STUB_ALLOWLIST = PHONE_IN_LIST;
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    await expect(sendViaEscapeHatch(PHONE_NOT_IN_LIST)).rejects.toMatchObject({
      response: { code: E_SMS_001 },
    });
    expect(smsUnavailableException('probe').response).toMatchObject({
      code: E_SMS_001,
    });
  });

  it('prod + 未配 allowlist → stub 全拒（更严，方案风险表预期）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'stub';
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    await expect(sendViaEscapeHatch(PHONE_IN_LIST)).rejects.toMatchObject({
      response: { code: E_SMS_001 },
    });
  });

  it('prod + tencent 逃生门入口（sendCode tencent 分支）同样被白名单收口', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'tencent';
    process.env.SMS_STUB_ALLOWLIST = PHONE_IN_LIST;
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    // R13：tencent 入口与 gateway 入口都汇入 sendStub，非白名单同样拒
    await expect(sendViaEscapeHatch(PHONE_NOT_IN_LIST)).rejects.toMatchObject({
      response: { code: E_SMS_001 },
    });
  });

  it('prod + gateway 逃生门入口（resolveGatewayOrEscape 回退）直接用例：非白名单拒（R13 收口）', async () => {
    // 审查报告 P3-3：gateway 缺凭据 + 逃生门开 → resolveGatewayOrEscape 回退 'stub'
    // → 汇入 sendStub 单点。provider 显式 gateway（凭据缺失不拒发走逃生门），
    // 非白名单号码应被 sendStub 白名单收口拒绝，且绝不调 gateway fetch。
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'gateway';
    process.env.SMS_STUB_ALLOWLIST = PHONE_IN_LIST;
    delete process.env.SMS_GATEWAY_URL;
    delete process.env.SMS_GATEWAY_AUTH_VALUE;
    delete process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    try {
      await expect(sendViaEscapeHatch(PHONE_NOT_IN_LIST)).rejects.toMatchObject({
        response: { code: E_SMS_001 },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('prod + gateway 逃生门入口 + 白名单命中 → 放行 stub（不调 gateway）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'gateway';
    process.env.SMS_STUB_ALLOWLIST = PHONE_IN_LIST;
    delete process.env.SMS_GATEWAY_URL;
    delete process.env.SMS_GATEWAY_AUTH_VALUE;
    delete process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    try {
      await expect(sendViaEscapeHatch(PHONE_IN_LIST)).resolves.toMatchObject({
        expireIn: 300,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('dev 无 allowlist → stub 全放行（行为不变回归）', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SMS_PROVIDER = 'stub';
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await expect(sendViaEscapeHatch(PHONE_NOT_IN_LIST)).resolves.toMatchObject({
      expireIn: 300,
    });
  });

  it('dev 开逃生门 + 白名单未命中 → 仍放行（allowlist 仅 prod 生效）', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SMS_STUB_ALLOWED = 'true';
    process.env.SMS_PROVIDER = 'stub';
    process.env.SMS_STUB_ALLOWLIST = PHONE_IN_LIST;
    vi.spyOn(logger, 'info').mockImplementation(() => logger);
    await expect(sendViaEscapeHatch(PHONE_NOT_IN_LIST)).resolves.toMatchObject({
      expireIn: 300,
    });
  });
});

// ─── ③ isE2eRateLimitBypass（A3） ───────────────────────────────────────
describe('isE2eRateLimitBypass（批1A A3：prod 恒 false）', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.E2E_RATELIMIT_BYPASS;
  });

  it('prod + E2E_RATELIMIT_BYPASS=true → 恒 false（bypass 无效）', () => {
    process.env.NODE_ENV = 'production';
    process.env.E2E_RATELIMIT_BYPASS = 'true';
    expect(isE2eRateLimitBypass()).toBe(false);
  });

  it('dev + E2E_RATELIMIT_BYPASS=true → true（行为不变对照）', () => {
    process.env.NODE_ENV = 'development';
    process.env.E2E_RATELIMIT_BYPASS = 'true';
    expect(isE2eRateLimitBypass()).toBe(true);
  });

  it('test 环境 + bypass → true（CI e2e 不受影响）', () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_RATELIMIT_BYPASS = 'true';
    expect(isE2eRateLimitBypass()).toBe(true);
  });

  it('prod 未配 flag → false（兜底）', () => {
    process.env.NODE_ENV = 'production';
    expect(isE2eRateLimitBypass()).toBe(false);
  });
});
