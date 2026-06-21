import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Mock Redis cache module
vi.mock('../src/shared/cache', () => ({
  blacklistJti: vi.fn().mockResolvedValue(undefined),
  isBlacklisted: vi.fn().mockResolvedValue(false),
}));

import { AuthService } from '../src/modules/auth/auth.service';
import type { RefreshPayload } from '../src/modules/auth/auth.service';

// 设置 JWT secrets
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
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
});
