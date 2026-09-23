/**
 * SMS 启动软告警单测（批A R8 · 步骤5）
 *
 * 覆盖：prod + gateway 缺凭据 → error 不抛不退进程；凭据齐备不告警；
 *       dev 不告警；逃生门 SMS_STUB_ALLOWED=true → error；
 *       SMS_PROVIDER=stub 显式指定不告警。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/infrastructure/otp/sms-gateway.client', () => ({
  readSmsGatewayConfig: () => (process.env.SMS_GATEWAY_URL ? { url: process.env.SMS_GATEWAY_URL } : null),
}));

import { assertSmsStartupConfig } from '../src/shared/monitoring/sms-startup-check';
import { logger } from '../src/shared/logger/logger';
import { clearSmsProviderCache } from '../src/infrastructure/otp/sms.strategy';

const errorSpy = logger.error as ReturnType<typeof vi.fn>;
const warnSpy = logger.warn as ReturnType<typeof vi.fn>;

describe('assertSmsStartupConfig（R8 启动软告警，不退进程）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSmsProviderCache();
    delete process.env.NODE_ENV;
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_GATEWAY_URL;
    delete process.env.SMS_GATEWAY_AUTH_VALUE;
    delete process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
    delete process.env.SMS_STUB_ALLOWED;
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.SMS_PROVIDER;
    delete process.env.SMS_GATEWAY_URL;
    delete process.env.SMS_GATEWAY_AUTH_VALUE;
    delete process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE;
    delete process.env.SMS_STUB_ALLOWED;
    delete process.env.TENCENT_SMS_SECRET_ID;
    delete process.env.TENCENT_SMS_SECRET_KEY;
    delete process.env.TENCENT_SMS_SDK_APP_ID;
    delete process.env.TENCENT_SMS_TEMPLATE_ID;
    clearSmsProviderCache();
  });

  it('prod + gateway 缺凭据 → error 软告警，不 throw（R8 不退进程）', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'gateway';
    expect(() => assertSmsStartupConfig()).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'GATEWAY_CREDENTIALS_MISSING' }));
  });

  it('prod + 未配置 SMS_PROVIDER（批A2 默认解析 tencent）+ 缺凭据 → tencent 告警', () => {
    process.env.NODE_ENV = 'production';
    assertSmsStartupConfig();
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'TENCENT_CREDENTIALS_MISSING' }));
  });

  it('prod + tencent 凭据齐备 → 不告警', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'tencent';
    process.env.TENCENT_SMS_SECRET_ID = 'id';
    process.env.TENCENT_SMS_SECRET_KEY = 'key';
    process.env.TENCENT_SMS_SDK_APP_ID = '1400123456';
    process.env.TENCENT_SMS_TEMPLATE_ID = '1234567';
    assertSmsStartupConfig();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prod + gateway 凭据齐备 → 不告警', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'gateway';
    process.env.SMS_GATEWAY_URL = 'https://gw.example.com';
    process.env.SMS_GATEWAY_AUTH_VALUE = 'Bearer x';
    process.env.SMS_GATEWAY_PAYLOAD_TEMPLATE = '{"to":"{{phone}}"}';
    assertSmsStartupConfig();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('dev 缺凭据 → 不告警（dev 默认 stub 是正常形态）', () => {
    assertSmsStartupConfig();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('prod + SMS_STUB_ALLOWED=true → error 告警（逃生门开着）', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_STUB_ALLOWED = 'true';
    assertSmsStartupConfig();
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: 'STUB_ESCAPE_HATCH_ON' }));
  });

  it('prod + 显式 stub → 不告警（stub 是显式决策）', () => {
    process.env.NODE_ENV = 'production';
    process.env.SMS_PROVIDER = 'stub';
    assertSmsStartupConfig();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
