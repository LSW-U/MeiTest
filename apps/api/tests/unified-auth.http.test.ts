/**
 * unified send 真 HTTP 端到端（批A 审查 P3-2 修复 + P1-2/P2-1 真 HTTP 验证）
 *
 * 审查 P3-2：任务书「端到端发码→校验（走 unified 端点）」此前只有 service 级
 * 串联（factory mock），未走 controller→pipe 真 HTTP 链——本文件把字面做实：
 *   - @nestjs/testing 起真 Nest HTTP 应用（listen(0) 随机端口 + node fetch，
 *     supertest 等价，仓库未装 supertest 不新增依赖）
 *   - 真链路：express → ZodValidationPipe（契约 UnifiedSendSmsRequest）→
 *     controller → service（mock）→ AllExceptionsFilter（真全局过滤器）
 *
 * 覆盖：
 *   1. P2-1 端到端生效：phone " +670 7123 4567 "（空格）→ pipe 归一化 →
 *      service 收到 E.164 "+67071234567"
 *   2. E.164 拒收真 400：非 E.164 号（"12345678"）→ 400 E-COMMON-001 + details
 *      （此前本地 min8/max20 schema 会放行——审查 P2-1 指出的主链路漏洞）
 *   3. P1-2 客户端表现真 503：HttpException(503, E-SMS-001) 经真
 *      AllExceptionsFilter → 客户端拿 503 + code=E-SMS-001 + 五语 message
 *      （Accept-Language: zh → errors.json 中文文案，i18n 注册生效）
 *   4. verify 端点契约生效：code 5 位 → 400（本地 schema 同款校验被契约替换后不回退）
 *
 * 自包含（redis/db/factory 全 mock，无需 dev server / docker），进 `pnpm test` 门禁。
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';

const { mockRedis, mockSendSms, mockVerifyDispatch } = vi.hoisted(() => ({
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  mockSendSms: vi.fn(),
  mockVerifyDispatch: vi.fn(),
}));

// 真 controller/service 模块链会评估 shared/cache、shared/db import——mock 断开真实连接
vi.mock('../src/shared/cache', () => ({
  redis: mockRedis,
  createTicket: vi.fn(),
  consumeTicket: vi.fn(),
}));
vi.mock('../src/shared/db', () => ({
  db: {},
  withTransaction: vi.fn(),
}));

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { UnifiedAuthController } from '../src/modules/auth/unified-auth.controller';
import { UnifiedAuthService } from '../src/modules/auth/unified-auth.service';
import { AllExceptionsFilter } from '../src/shared/filters/all-exceptions.filter';

// service mock：503 用例对特定 phone 抛 HttpException（模拟策略拒发形态）
const mockService = {
  sendSmsCodeWithChallenge: mockSendSms,
  verifyAndDispatch: mockVerifyDispatch,
  completeRegistration: vi.fn(),
};

let app: INestApplication;
let base: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [UnifiedAuthController],
    providers: [{ provide: UnifiedAuthService, useValue: mockService }],
  }).compile();

  app = moduleRef.createNestApplication();
  // 真全局过滤器（AppModule 同款注册方式）：HttpException → 503+code 的客户端映射在这里发生
  app.useGlobalFilters(new AllExceptionsFilter(app.get(HttpAdapterHost)));
  await app.listen(0);
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function post(path: string, body: unknown, acceptLanguage?: string): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('e2e: unified send 真 HTTP 链（controller→pipe→filter）', () => {
  it('P2-1 端到端：phone 带空格 → pipe 归一化 → service 收到 E.164', async () => {
    mockSendSms.mockResolvedValue({ challengeId: 'ch-http-1', expireIn: 300 });

    const res = await post('/api/v1/common/auth/sms/send', { phone: '+670 7123 4567' });
    expect(res.status).toBe(HttpStatus.ACCEPTED);
    const body = (await res.json()) as { success: boolean; data: { challengeId: string } };
    expect(body.success).toBe(true);
    expect(body.data.challengeId).toBe('ch-http-1');
    // 归一化在真 HTTP pipe 层发生（不是 service 里），service 收到清洗后的 E.164
    expect(mockSendSms).toHaveBeenCalledWith('+67071234567', undefined);
  });

  it('P2-1 端到端：非 E.164 号（"12345678"）→ 真 400 拒收（旧 min8/max20 会放行）', async () => {
    const res = await post('/api/v1/common/auth/sms/send', { phone: '12345678' });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('E-COMMON-001');
    expect(body.error.details.some((d) => d.path === 'phone')).toBe(true);
    expect(mockSendSms).not.toHaveBeenCalled(); // 拒收在 pipe 层，未触达 service
  });

  it('P1-2 客户端表现：503 E-SMS-001 经真过滤器 → 503 + 明确码 + 五语文案（zh）', async () => {
    // 模拟 SmsStrategy 运行时拒发形态（provider 单测已验策略本体，此处验 HTTP 映射层）
    mockSendSms.mockImplementation(async (phone: string) => {
      if (phone === '+67077777777') {
        throw new HttpException(
          {
            code: 'E-SMS-001',
            message: 'SMS verification service is temporarily unavailable',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      return { challengeId: 'ch-x', expireIn: 300 };
    });

    const res = await post(
      '/api/v1/common/auth/sms/send',
      { phone: '+67077777777' },
      'zh',
    );
    expect(res.status).toBe(HttpStatus.SERVICE_UNAVAILABLE); // 不再是泛化 500
    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; i18nKey: string };
    };
    expect(body.error.code).toBe('E-SMS-001'); // 客户端拿到明确码，非 E-COMMON-002
    expect(body.error.i18nKey).toBe('errors.E-SMS-001');
    expect(body.error.message).toBe('验证码服务暂不可用，请稍后重试'); // 五语注册经 localizeErrorMessage 生效
  });

  it('verify 端点契约生效：code 5 位 → 真 400（契约 schema 替换本地 schema 后校验不回退）', async () => {
    const res = await post('/api/v1/common/auth/sms/verify', {
      phone: '+67012345678',
      code: '12345',
      challengeId: '11111111-1111-4111-8111-111111111111',
    });
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('E-COMMON-001');
    expect(mockVerifyDispatch).not.toHaveBeenCalled();
  });
});
