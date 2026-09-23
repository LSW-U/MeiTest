/**
 * 腾讯云 SMS 策略单测（批A2 · T1 provider 三态分流）
 *
 * 覆盖：
 *   - provider 三态：stub / tencent / tencent 缺凭据运行时拒发（P1-1 教训不回潮：构造不抛）
 *   - SDK 调用参数 mock：+670 E.164 前缀 / TemplateParamSet=[6位码] / 不带 SignName（留空）
 *   - SendStatus.Code != Ok → 503 E-SMS-001（provider_error 分桶）
 *   - production 未配置 SMS_PROVIDER → 默认 tencent（与 gateway 同语义）
 *   - 逃生门 SMS_STUB_ALLOWED=true 放行 stub
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

const mockSendSms = vi.fn();
vi.mock('tencentcloud-sdk-nodejs-sms', () => ({
  sms: {
    v20210111: {
      Client: class {
        SendSms = mockSendSms;
      },
    },
  },
}));

import { HttpException, HttpStatus } from '@nestjs/common';
import {
  SmsStrategy,
  clearSmsProviderCache,
  E_SMS_001,
} from '../src/infrastructure/otp/sms.strategy';
import {
  readTencentSmsConfig,
  TencentSmsStrategy,
} from '../src/infrastructure/otp/tencent-sms.strategy';

const TENCENT_ENV = {
  SMS_PROVIDER: 'tencent',
  TENCENT_SMS_SECRET_ID: 'test-id',
  TENCENT_SMS_SECRET_KEY: 'test-key',
  TENCENT_SMS_SDK_APP_ID: '1400123456',
  TENCENT_SMS_TEMPLATE_ID: '2000001',
};

function makeStrategy(env: Record<string, string | undefined>): SmsStrategy {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  clearSmsProviderCache();
  return new SmsStrategy();
}

function okResp() {
  return { SendStatusSet: [{ Code: 'Ok', SerialNo: 'sn-1', Fee: 1 }] };
}

describe('TencentSmsStrategy（批A2 T1）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockRedis.set.mockResolvedValue('OK');
  });

  afterEach(() => {
    clearSmsProviderCache();
    delete process.env.SMS_PROVIDER;
    for (const k of Object.keys(TENCENT_ENV).filter((k) => k !== 'SMS_PROVIDER')) {
      delete process.env[k];
    }
    delete process.env.TENCENT_SMS_REGION;
    delete process.env.TENCENT_SMS_SIGN_NAME;
    delete process.env.SMS_STUB_ALLOWED;
    delete process.env.NODE_ENV;
  });

  it('provider=tencent → isMock=false；构造不抛（P1-1，缺凭据不炸模块加载）', () => {
    const s = makeStrategy({ SMS_PROVIDER: 'tencent' });
    expect(s.isMock).toBe(false);
  });

  it('provider=tencent 缺凭据 → sendCode 运行时拒发 503 E-SMS-001，不落 Redis 不调 SDK', async () => {
    const s = makeStrategy({ SMS_PROVIDER: 'tencent' });
    const err = await s.sendCode({ target: '+67012345678', scene: 'LOGIN' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect((err.getResponse() as { code?: string }).code).toBe(E_SMS_001);
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('production 未配置 SMS_PROVIDER → 默认 tencent（与 gateway 同语义）', () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({});
    expect(s.isMock).toBe(false);
    const delegate = new TencentSmsStrategy();
    expect(delegate.isMock).toBe(false);
  });

  it('凭据齐备 → SDK 调用参数：+670 E.164 / TemplateParamSet=[6位码] / 留空不带 SignName', async () => {
    const s = makeStrategy(TENCENT_ENV);
    mockSendSms.mockResolvedValue(okResp());

    await s.sendCode({ target: '67012345678', scene: 'LOGIN' }); // 兜底补 '+'

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    const req = mockSendSms.mock.calls[0][0] as {
      PhoneNumberSet: string[];
      SmsSdkAppId: string;
      TemplateId: string;
      TemplateParamSet: string[];
      SignName?: string;
    };
    expect(req.PhoneNumberSet).toEqual(['+67012345678']);
    expect(req.SmsSdkAppId).toBe('1400123456');
    expect(req.TemplateId).toBe('2000001');
    expect(req.TemplateParamSet).toHaveLength(1);
    expect(req.TemplateParamSet[0]).toMatch(/^\d{6}$/);
    expect(req.SignName).toBeUndefined();
    // 6 位码已落 Redis 同款键结构
    const setCall = mockRedis.set.mock.calls[0] as unknown[];
    expect(setCall[0]).toBe('otp:sms:LOGIN:+67012345678');
    expect(setCall[1]).toBe(req.TemplateParamSet[0]);
    expect(setCall[2]).toBe('EX');
    expect(setCall[3]).toBe(300);
  });

  it('SendStatus.Code != Ok → 503 E-SMS-001（provider_error）', async () => {
    const s = makeStrategy(TENCENT_ENV);
    mockSendSms.mockResolvedValue({
      SendStatusSet: [{ Code: 'LimitExceeded.PhoneNumberDailyLimit', Message: 'delivery limit' }],
    });
    const err = await s.sendCode({ target: '+67012345678', scene: 'LOGIN' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err.getResponse() as { code?: string }).code).toBe(E_SMS_001);
  });

  it('SDK 网络/签名异常 → 包装 503 E-SMS-001，不裸冒 500 E-COMMON-002（P1-2 同款）', async () => {
    const s = makeStrategy(TENCENT_ENV);
    mockSendSms.mockRejectedValue(new Error('TC3 sign failed'));
    const err = await s.sendCode({ target: '+67012345678', scene: 'LOGIN' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('逃生门 SMS_STUB_ALLOWED=true：provider=tencent 也放行 stub（不调 SDK）', async () => {
    process.env.NODE_ENV = 'production';
    const s = makeStrategy({ ...TENCENT_ENV, SMS_STUB_ALLOWED: 'true' });
    expect(s.isMock).toBe(true);
    await s.sendCode({ target: '+67012345678', scene: 'LOGIN' });
    expect(mockRedis.set).toHaveBeenCalled();
    expect(mockSendSms).not.toHaveBeenCalled();
  });

  it('readTencentSmsConfig：四项必填缺一 → null；SIGN_NAME 空串视为未配置', () => {
    for (const k of ['TENCENT_SMS_SECRET_ID', 'TENCENT_SMS_SECRET_KEY', 'TENCENT_SMS_SDK_APP_ID', 'TENCENT_SMS_TEMPLATE_ID']) {
      const s = makeStrategy({ ...TENCENT_ENV, [k]: undefined });
      expect(readTencentSmsConfig()).toBeNull();
      void s;
    }
    makeStrategy({ ...TENCENT_ENV, TENCENT_SMS_SIGN_NAME: '' });
    const config = readTencentSmsConfig();
    expect(config?.signName).toBeUndefined();
    expect(config?.region).toBe('ap-guangzhou');
  });
});
