/**
 * UnifiedAuthService 单测（W7-ext-H 统一手机号入口；批A A-2 收敛后重写）
 *
 * 收敛语义（R11+R19）：
 *   - send：调 factory sendCode（code 键 otp:sms:{scene}:{target} 归 factory）
 *           + 落映射键 otp:chal:{challengeId} = {scene, target}
 *   - verify：查映射键 → phone 绑定校验 → factory.verifyCode → 成功删映射键
 *   - 失败一律 E-USER-003（不外泄 WRONG_CODE/EXPIRED 细节）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';

// Mock cache（registration-ticket + redis；OTP code 键归 factory，测试里 mock factory）
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

// Mock otp factory（收敛后 unified 只经 factory 收发 OTP，不碰其 Redis 细节）
const { mockSendCode, mockVerifyCode } = vi.hoisted(() => ({
  mockSendCode: vi.fn(),
  mockVerifyCode: vi.fn(),
}));
vi.mock('../src/infrastructure/otp/otp.factory', () => ({
  getOtpStrategy: () => ({ sendCode: mockSendCode, verifyCode: mockVerifyCode }),
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
import type { OtpSendInput, OtpVerifyInput } from '../src/infrastructure/otp/otp-strategy';

const PHONE = '+67012345678';
const CHALLENGE_KEY = 'otp:chal:ch-1';

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

  describe('sendSmsCodeWithChallenge（收敛后：factory 发码 + 映射键）', () => {
    it('调 factory.sendCode（scene=LOGIN）+ 落 otp:chal:{challengeId} 映射键（JSON 含 scene+target）', async () => {
      mockSendCode.mockResolvedValue({ expireIn: 300 });
      mockRedis.set.mockResolvedValue('OK');

      const result = await service.sendSmsCodeWithChallenge(PHONE);

      expect(result.challengeId).toBeTruthy();
      expect(result.expireIn).toBe(300);
      // factory 收到 scene + target（code 键由 factory 落，unified 不再自写）
      expect(mockSendCode).toHaveBeenCalledTimes(1);
      const sendInput = mockSendCode.mock.calls[0][0] as OtpSendInput;
      expect(sendInput.target).toBe(PHONE);
      expect(sendInput.scene).toBe('LOGIN');
      // 映射键：otp:chal: 前缀（消除与工厂 otp:sms: 双语义），值={scene,target}，同 TTL 300
      expect(mockRedis.set).toHaveBeenCalledWith(
        `otp:chal:${result.challengeId}`,
        JSON.stringify({ scene: 'LOGIN', target: PHONE }),
        'EX', 300,
      );
    });

    it('不再写旧键 otp:sms:{challengeId}（双语义清除）', async () => {
      mockSendCode.mockResolvedValue({ expireIn: 300 });
      mockRedis.set.mockResolvedValue('OK');
      await service.sendSmsCodeWithChallenge(PHONE);
      const setKey = (mockRedis.set.mock.calls[0][0] as string);
      expect(setKey.startsWith('otp:chal:')).toBe(true);
      expect(setKey.startsWith('otp:sms:')).toBe(false);
    });

    it('factory 抛错（如 E-SMS-001 缺凭据）→ 透传，不落映射键', async () => {
      mockSendCode.mockRejectedValue(new Error('E-SMS-001: gateway not configured'));
      await expect(service.sendSmsCodeWithChallenge(PHONE)).rejects.toThrow('E-SMS-001');
      expect(mockRedis.set).not.toHaveBeenCalled();
    });
  });

  describe('verifyAndDispatch（收敛后：查映射 → factory 校验 → 两键齐删）', () => {
    const CHAL_JSON = JSON.stringify({ scene: 'LOGIN', target: PHONE });

    it('映射键不存在/过期 -> E-USER-003（且不调 factory）', async () => {
      mockRedis.get.mockResolvedValue(null);
      await expect(service.verifyAndDispatch(PHONE, '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
      expect(mockVerifyCode).not.toHaveBeenCalled();
    });

    it('phone 绑定校验：challenge 的 target 与请求 phone 不等 -> E-USER-003（不调 factory）', async () => {
      mockRedis.get.mockResolvedValue(JSON.stringify({ scene: 'LOGIN', target: '+67099999999' }));
      await expect(service.verifyAndDispatch(PHONE, '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
      expect(mockVerifyCode).not.toHaveBeenCalled();
    });

    it('factory 判 WRONG_CODE -> 对外仍 E-USER-003（不外泄 reason 细节，N-2 #4）', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: false, reason: 'WRONG_CODE' });
      await expect(service.verifyAndDispatch(PHONE, '000000', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
    });

    it('factory 判 EXPIRED -> 对外仍 E-USER-003', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: false, reason: 'EXPIRED' });
      await expect(service.verifyAndDispatch(PHONE, '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
    });

    it('verify 失败不删映射键（challenge 仍可重试到 TTL）', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: false, reason: 'WRONG_CODE' });
      await service.verifyAndDispatch(PHONE, '000000', 'ch-1').catch(() => undefined);
      expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('未注册 -> REGISTER + ticket + 删映射键', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: true });
      userFindUnique.mockResolvedValue(null);
      mockCreateTicket.mockResolvedValue('ticket-plain');
      const result = await service.verifyAndDispatch(PHONE, '123456', 'ch-1');
      expect(result.action).toBe('REGISTER');
      expect(result.registrationTicket).toBe('ticket-plain');
      // 两键齐删：code 键归 factory（mock 里看不到），映射键由 unified 删
      expect(mockVerifyCode).toHaveBeenCalledWith(
        expect.objectContaining({ target: PHONE, code: '123456', scene: 'LOGIN' }) satisfies OtpVerifyInput,
      );
      expect(mockRedis.del).toHaveBeenCalledWith(CHALLENGE_KEY);
    });

    it('已注册 + ACTIVE -> LOGIN + token + 删映射键', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: true });
      userFindUnique.mockResolvedValue({ id: 'u1', phone: PHONE, role: 'CUSTOMER', status: 'ACTIVE' });
      const result = await service.verifyAndDispatch(PHONE, '123456', 'ch-1');
      expect(result.action).toBe('LOGIN');
      expect(result.accessToken).toBe('access');
      expect(result.user?.id).toBe('u1');
      expect(mockRedis.del).toHaveBeenCalledWith(CHALLENGE_KEY);
    });

    it('冻结 -> BLOCKED（验证已过，映射键已删）', async () => {
      mockRedis.get.mockResolvedValue(CHAL_JSON);
      mockVerifyCode.mockResolvedValue({ valid: true });
      userFindUnique.mockResolvedValue({ id: 'u1', status: 'SUSPENDED', role: 'CUSTOMER', phone: PHONE });
      const result = await service.verifyAndDispatch(PHONE, '123456', 'ch-1');
      expect(result.action).toBe('BLOCKED');
      expect(mockRedis.del).toHaveBeenCalledWith(CHALLENGE_KEY);
    });

    it('映射键值损坏（旧结构残留/脏 JSON）-> E-USER-003 不抛 500', async () => {
      mockRedis.get.mockResolvedValue('{"phone":"+67012345678","code":"123456","expiresAt":1}'); // 旧结构：无 scene/target
      await expect(service.verifyAndDispatch(PHONE, '123456', 'ch-1'))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
    });
  });

  describe('端到端：发码 → 校验全链走 unified（mock redis/factory 串联）', () => {
    it('send 落的映射键被 verify 消费，两步场景参数严格衔接', async () => {
      // --- 第一步：发码 ---
      mockSendCode.mockResolvedValue({ expireIn: 300 });
      mockRedis.set.mockResolvedValue('OK');
      const { challengeId } = await service.sendSmsCodeWithChallenge(PHONE);

      // 模拟 Redis 真实交互：send 落的键值，verify 时读回
      const storedKey = mockRedis.set.mock.calls[0][0] as string;
      const storedVal = mockRedis.set.mock.calls[0][1] as string;
      mockRedis.get.mockResolvedValue(storedVal);
      mockVerifyCode.mockResolvedValue({ valid: true });
      userFindUnique.mockResolvedValue({ id: 'u1', phone: PHONE, role: 'CUSTOMER', status: 'ACTIVE' });

      // --- 第二步：校验 ---
      const result = await service.verifyAndDispatch(PHONE, '123456', challengeId);

      expect(result.action).toBe('LOGIN');
      // verify 读取的键 = send 写入的键（同键衔接，且为 otp:chal: 前缀）
      expect(mockRedis.get).toHaveBeenCalledWith(storedKey);
      expect(storedKey).toBe(`otp:chal:${challengeId}`);
      // factory 校验参数 = send 参数（scene/target 一致）
      expect(mockVerifyCode).toHaveBeenCalledWith({ target: PHONE, code: '123456', scene: 'LOGIN' });
      // 消费后映射键删除
      expect(mockRedis.del).toHaveBeenCalledWith(storedKey);
    });

    it('换号重放：用同一 challengeId + 另一 phone verify -> E-USER-003', async () => {
      mockSendCode.mockResolvedValue({ expireIn: 300 });
      mockRedis.set.mockResolvedValue('OK');
      const { challengeId } = await service.sendSmsCodeWithChallenge(PHONE);

      mockRedis.get.mockResolvedValue(mockRedis.set.mock.calls[0][1] as string);
      await expect(service.verifyAndDispatch('+67088888888', '123456', challengeId))
        .rejects.toMatchObject({ response: { code: 'E-USER-003' } });
      expect(mockVerifyCode).not.toHaveBeenCalled();
      expect(mockRedis.del).not.toHaveBeenCalled();
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
        data: { phone: PHONE, challengeId: 'wrong-ch', purpose: 'COMPLETE_BUYER_REGISTRATION', verifiedAt: 1, expiresAt: 2 },
      });
      await expect(service.completeRegistration({
        registrationTicket: 't', agreedToTerms: true, challengeId: 'ch-1',
      })).rejects.toMatchObject({ response: { code: 'E-REGISTER-001' }, status: 410 });
    });

    it('Happy path -> 创建 CUSTOMER + 签 token', async () => {
      mockConsumeTicket.mockResolvedValue({
        status: 'OK',
        data: { phone: PHONE, challengeId: 'ch-1', purpose: 'COMPLETE_BUYER_REGISTRATION', verifiedAt: 1, expiresAt: 2 },
      });
      txCreate.mockResolvedValue({ id: 'new-u', phone: PHONE, role: 'CUSTOMER' });
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
