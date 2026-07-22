/**
 * UnifiedAuthService 单测（W7-ext-H 统一手机号入口）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';

// Mock cache（registration-ticket + redis + refresh-session）
const { mockRedis, mockCreateTicket, mockConsumeTicket } = vi.hoisted(() => ({
  mockRedis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
  mockCreateTicket: vi.fn(),
  mockConsumeTicket: vi.fn(),
}));

vi.mock('../src/shared/cache', () => ({
  redis: mockRedis,
  createTicket: mockCreateTicket,
  consumeTicket: mockConsumeTicket,
}));

// Mock db
const { userFindUnique, userCreate, txCreate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  txCreate: vi.fn(),
}));
vi.mock('../src/shared/db', () => ({
  db: { user: { findUnique: userFindUnique } },
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({ user: { create: txCreate } })),
}));

// Mock AuthService
const mockAuthService = {
  toContractRole: (r: string) => r, // Prisma 大写，直接返回（v0.4 大写）
  inferDeviceTypeFromRole: () => 'client_app',
  signTokenPair: vi.fn().mockResolvedValue({
    accessToken: 'access', refreshToken: 'refresh',
    accessExpiresAt: 1, refreshExpiresAt: 2,
  }),
};

import { UnifiedAuthService } from '../src/modules/auth/unified-auth.service';

describe('UnifiedAuthService', () => {
  let service: UnifiedAuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    // 重设 signTokenPair（resetAllMocks 清了 mockResolvedValue）
    mockAuthService.signTokenPair.mockResolvedValue({
      accessToken: 'access', refreshToken: 'refresh',
      accessExpiresAt: 1, refreshExpiresAt: 2,
    });
    service = new UnifiedAuthService(mockAuthService as never);
  });

  describe('sendSmsCodeWithChallenge', () => {
    it('生成 challengeId + 存 OTP', async () => {
      mockRedis.set.mockResolvedValue('OK');
      const result = await service.sendSmsCodeWithChallenge('+67012345678');
      expect(result.challengeId).toBeTruthy();
      expect(result.expireIn).toBe(300);
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^otp:sms:/),
        expect.stringContaining('"phone":"+67012345678"'),
        'EX', 300,
      );
    });
  });

  describe('verifyAndDispatch', () => {
    it('OTP 无效 -> E-USER-003', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.verifyAndDispatch('+67012345678', '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
    });

    it('OTP 不匹配 -> E-USER-003', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ phone: '+67012345678', code: '999999' }));
      await expect(service.verifyAndDispatch('+67012345678', '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
    });

    it('未注册 -> REGISTER + ticket', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ phone: '+67012345678', code: '123456' }));
      userFindUnique.mockResolvedValue(null);
      mockCreateTicket.mockResolvedValue('ticket-plain');
      const result = await service.verifyAndDispatch('+67012345678', '123456', 'ch-1');
      expect(result.action).toBe('REGISTER');
      expect(result.registrationTicket).toBe('ticket-plain');
    });

    it('已注册 + ACTIVE -> LOGIN + token', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ phone: '+67012345678', code: '123456' }));
      userFindUnique.mockResolvedValue({ id: 'u1', phone: '+67012345678', role: 'CUSTOMER', status: 'ACTIVE' });
      const result = await service.verifyAndDispatch('+67012345678', '123456', 'ch-1');
      expect(result.action).toBe('LOGIN');
      expect(result.accessToken).toBe('access');
      expect(result.user?.id).toBe('u1');
    });

    it('冻结 -> BLOCKED', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ phone: '+67012345678', code: '123456' }));
      userFindUnique.mockResolvedValue({ id: 'u1', status: 'SUSPENDED', role: 'CUSTOMER', phone: '+67012345678' });
      const result = await service.verifyAndDispatch('+67012345678', '123456', 'ch-1');
      expect(result.action).toBe('BLOCKED');
    });
  });

  describe('completeRegistration', () => {
    it('未同意条款 -> E-REGISTER-003', async () => {
      await expect(service.completeRegistration({
        registrationTicket: 't', agreedToTerms: false as never, challengeId: 'ch-1',
      })).rejects.toMatchObject({ response: { code: 'E-REGISTER-003' } });
    });

    it('ticket 失效 -> E-REGISTER-001', async () => {
      mockConsumeTicket.mockResolvedValue({ status: 'INVALID_OR_USED' });
      await expect(service.completeRegistration({
        registrationTicket: 't', agreedToTerms: true, challengeId: 'ch-1',
      })).rejects.toMatchObject({ response: { code: 'E-REGISTER-001' }, status: 410 });
    });

    it('challengeId 不匹配 -> E-REGISTER-001', async () => {
      mockConsumeTicket.mockResolvedValue({
        status: 'OK',
        data: { phone: '+67012345678', challengeId: 'wrong-ch', purpose: 'COMPLETE_BUYER_REGISTRATION', verifiedAt: 1, expiresAt: 2 },
      });
      await expect(service.completeRegistration({
        registrationTicket: 't', agreedToTerms: true, challengeId: 'ch-1',
      })).rejects.toMatchObject({ response: { code: 'E-REGISTER-001' }, status: 410 });
    });

    it('Happy path -> 创建 CUSTOMER + 签 token', async () => {
      mockConsumeTicket.mockResolvedValue({
        status: 'OK',
        data: { phone: '+67012345678', challengeId: 'ch-1', purpose: 'COMPLETE_BUYER_REGISTRATION', verifiedAt: 1, expiresAt: 2 },
      });
      txCreate.mockResolvedValue({ id: 'new-u', phone: '+67012345678', role: 'CUSTOMER' });
      const result = await service.completeRegistration({
        registrationTicket: 't', agreedToTerms: true, challengeId: 'ch-1',
      });
      expect(result.accessToken).toBe('access');
      expect(result.user.id).toBe('new-u');
      expect(result.user.role).toBe('CUSTOMER'); // v0.4 角色大写
      // DB 事务创建 User（role=CUSTOMER + agreedTermsVersion）
      expect(txCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          role: 'CUSTOMER',
          agreedTermsVersion: 'v1.0',
          phoneVerified: true,
        }),
      }));
    });
  });
});
