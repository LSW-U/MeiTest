import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';

// Mock Redis cache module
vi.mock('../src/shared/cache', () => ({
  blacklistJti: vi.fn().mockResolvedValue(undefined),
  isBlacklisted: vi.fn().mockResolvedValue(false),
}));

// Mock SMS OTP strategy（避免依赖 Redis）
vi.mock('../src/infrastructure/otp/otp.factory', () => ({
  getOtpStrategy: () => ({
    sendCode: vi.fn().mockResolvedValue({ expireIn: 300 }),
    verifyCode: vi.fn().mockImplementation(({ code }: { code: string }) =>
      Promise.resolve(code === '123456' ? { valid: true } : { valid: false, reason: 'WRONG_CODE' }),
    ),
  }),
}));

// Mock db（W 流程业务方法依赖 user 表，必须用 vi.hoisted 因为 vi.mock 工厂被 hoist）
const { userFindUnique, userCreate, userUpdate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userCreate: vi.fn(),
  userUpdate: vi.fn(),
}));
vi.mock('../src/shared/db', () => ({
  db: {
    user: {
      findUnique: userFindUnique,
      create: userCreate,
      update: userUpdate,
    },
  },
}));

import { AuthService } from '../src/modules/auth/auth.service';
import { passwordStrategy } from '../src/infrastructure/otp/password.strategy';
import type { RefreshPayload } from '../src/modules/auth/auth.service';

// 设置 JWT secrets
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    // resetAllMocks 清 calls + implementation + once queue（vs clearAllMocks 只清 calls）
    vi.resetAllMocks();
    // 用真实 JwtService（@nestjs/jwt 的 signAsync/verifyAsync 是纯函数，不需 mock）
    const { JwtService } = require('@nestjs/jwt');
    service = new AuthService(new JwtService({}));
  });

  describe('signAccessToken', () => {
    it('签发 client_app token（30d TTL）', async () => {
      const { token, expiresIn } = await service.signAccessToken(
        'user-1',
        'customer',
        'client_app',
      );
      expect(token).toBeTruthy();
      expect(expiresIn).toBe(30 * 24 * 60 * 60); // 30 天（秒）
    });

    it('签发 rider_app token（12h TTL）', async () => {
      const { token, expiresIn } = await service.signAccessToken('user-2', 'rider', 'rider_app');
      expect(expiresIn).toBe(12 * 60 * 60); // 12 小时
    });

    it('签发 admin_web token（2h TTL）', async () => {
      const { token, expiresIn } = await service.signAccessToken(
        'user-3',
        'super_admin',
        'admin_web',
      );
      expect(expiresIn).toBe(2 * 60 * 60); // 2 小时
    });
  });

  describe('signRefreshToken', () => {
    it('签发 refresh token 含 jti', async () => {
      const { token, jti, expiresIn } = await service.signRefreshToken('user-1', 'client_app');
      expect(token).toBeTruthy();
      expect(jti).toBeTruthy();
      expect(expiresIn).toBe(60 * 24 * 60 * 60); // 60 天
    });

    it('refresh token 不含 role（避免权限长期暴露）', async () => {
      const { token } = await service.signRefreshToken('user-1', 'client_app');
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf-8'),
      ) as RefreshPayload;
      expect(payload.role).toBeUndefined();
      expect(payload.sub).toBe('user-1');
      expect(payload.deviceType).toBe('client_app');
      expect(payload.jti).toBeTruthy();
    });
  });

  describe('verifyAccessToken', () => {
    it('正确 token 验证通过', async () => {
      const { token } = await service.signAccessToken('user-1', 'customer', 'client_app');
      const payload = await service.verifyAccessToken(token);
      expect(payload.sub).toBe('user-1');
      expect(payload.role).toBe('customer');
      expect(payload.deviceType).toBe('client_app');
    });

    it('无效 token 抛 UnauthorizedException', async () => {
      await expect(service.verifyAccessToken('invalid.token.here')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyRefreshToken', () => {
    it('正确 refresh token 验证通过', async () => {
      const { token, jti } = await service.signRefreshToken('user-1', 'client_app');
      const result = await service.verifyRefreshToken(token);
      expect(result.jti).toBe(jti);
      expect(result.payload.sub).toBe('user-1');
    });

    it('无效 refresh token 抛 UnauthorizedException', async () => {
      await expect(service.verifyRefreshToken('invalid.refresh.token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('正确 refresh token logout 返回 jti', async () => {
      const { token, jti } = await service.signRefreshToken('user-1', 'client_app');
      const result = await service.logout(token);
      expect(result).toBe(jti);
    });
  });

  // ==========================================================================
  // W 流程业务方法测试（2026-06-24 加）
  // ==========================================================================

  describe('inferDeviceTypeFromRole + toContractRole', () => {
    it('customer → client_app', () => {
      expect(service.inferDeviceTypeFromRole('customer')).toBe('client_app');
    });

    it('rider → rider_app', () => {
      expect(service.inferDeviceTypeFromRole('rider')).toBe('rider_app');
    });

    it('super_admin/warehouse_staff/customer_service → admin_web', () => {
      expect(service.inferDeviceTypeFromRole('super_admin')).toBe('admin_web');
      expect(service.inferDeviceTypeFromRole('warehouse_staff')).toBe('admin_web');
      expect(service.inferDeviceTypeFromRole('customer_service')).toBe('admin_web');
    });

    it('Prisma 大写 role 转 contract 小写', () => {
      expect(service.toContractRole('SUPER_ADMIN')).toBe('super_admin');
      expect(service.toContractRole('CUSTOMER')).toBe('customer');
      expect(service.toContractRole('WAREHOUSE_STAFF')).toBe('warehouse_staff');
    });
  });

  describe('loginWithPassword', () => {
    it('密码正确返回 token pair + role', async () => {
      const passwordHash = await passwordStrategy.hashPassword('Pass1234');
      userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        phone: '+670999999999',
        password: passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
      userUpdate.mockResolvedValue({});

      const result = await service.loginWithPassword('+670999999999', 'Pass1234');
      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('customer');
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it('用户不存在抛 E-USER-001', async () => {
      userFindUnique.mockResolvedValueOnce(null);
      await expect(service.loginWithPassword('+670000000000', 'Pass1234')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('密码错误抛 E-USER-002', async () => {
      const passwordHash = await passwordStrategy.hashPassword('Pass1234');
      userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        password: passwordHash,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
      await expect(service.loginWithPassword('+670999999999', 'WrongPass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('SUSPENDED 用户抛 E-USER-005', async () => {
      userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        password: 'hash',
        role: 'CUSTOMER',
        status: 'SUSPENDED',
      });
      await expect(service.loginWithPassword('+670999999999', 'Pass1234')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('loginWithSms', () => {
    it('已注册用户 SMS 登录成功', async () => {
      userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        phone: '+670999999999',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        phoneVerified: true,
      });
      userUpdate.mockResolvedValue({});

      const result = await service.loginWithSms('+670999999999', '123456');
      expect(result.userId).toBe('user-1');
      expect(result.role).toBe('customer');
    });

    it('SMS 错误抛 E-USER-003', async () => {
      await expect(service.loginWithSms('+670999999999', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('未注册用户自动创建 customer', async () => {
      userFindUnique.mockResolvedValueOnce(null); // 第一次查不到
      userCreate.mockResolvedValueOnce({
        id: 'new-user',
        phone: '+670888888888',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
      userUpdate.mockResolvedValue({});

      const result = await service.loginWithSms('+670888888888', '123456');
      expect(result.userId).toBe('new-user');
      expect(result.role).toBe('customer');
      expect(userCreate).toHaveBeenCalled();
    });
  });

  describe('registerUser', () => {
    it('注册成功返回 token pair', async () => {
      userFindUnique
        .mockResolvedValueOnce(null) // phone 查不到
        .mockResolvedValueOnce(null); // email 查不到
      userCreate.mockResolvedValueOnce({
        id: 'new-user',
        phone: '+670777777777',
        role: 'CUSTOMER',
        status: 'ACTIVE',
      });
      userUpdate.mockResolvedValue({});

      const result = await service.registerUser({
        phone: '+670777777777',
        password: 'Pass1234',
        smsCode: '123456',
      });
      expect(result.userId).toBe('new-user');
      expect(result.role).toBe('customer');
    });

    it('手机号已注册抛 E-USER-004', async () => {
      userFindUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.registerUser({
          phone: '+670777777777',
          password: 'Pass1234',
          smsCode: '123456',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('SMS 必传，缺 smsCode 抛 E-USER-003', async () => {
      userFindUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      await expect(
        service.registerUser({
          phone: '+670777777777',
          password: 'Pass1234',
          // smsCode 缺
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('sendSmsCode', () => {
    it('返回 expireIn', async () => {
      const result = await service.sendSmsCode('+670999999999', 'LOGIN');
      expect(result.expireIn).toBe(300);
    });
  });

  describe('resetPassword', () => {
    it('重置成功', async () => {
      userFindUnique.mockResolvedValueOnce({
        id: 'user-1',
        phone: '+670999999999',
      });
      userUpdate.mockResolvedValue({});

      await service.resetPassword({
        phone: '+670999999999',
        smsCode: '123456',
        newPassword: 'NewPass1234',
      });
      expect(userUpdate).toHaveBeenCalled();
    });

    it('用户不存在抛 E-USER-001', async () => {
      userFindUnique.mockResolvedValueOnce(null);
      await expect(
        service.resetPassword({
          phone: '+670000000000',
          smsCode: '123456',
          newPassword: 'NewPass1234',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('SMS 错误抛 E-USER-003', async () => {
      userFindUnique.mockResolvedValueOnce({ id: 'user-1' });
      await expect(
        service.resetPassword({
          phone: '+670999999999',
          smsCode: '000000',
          newPassword: 'NewPass1234',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
