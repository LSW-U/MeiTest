/**
 * Auth Controller refresh 端点单测（W7-fix 2026-07-10）
 *
 * 覆盖审查报告 P0 修复：
 *   - SUSPENDED/DELETED 用户 refresh -> E-USER-005
 *   - 密码重置后旧 refreshToken refresh -> E-AUTH-006
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

// Mock cache（refresh 不查 Redis，但 verifyRefreshToken 依赖）
vi.mock('../src/shared/cache', () => ({
  blacklistJti: vi.fn().mockResolvedValue(undefined),
  isBlacklisted: vi.fn().mockResolvedValue(false),
}));

// Mock SMS（controller 不用，但 AuthService 构造时引用）
vi.mock('../src/infrastructure/otp/otp.factory', () => ({
  getOtpStrategy: () => ({
    sendCode: vi.fn().mockResolvedValue({ expireIn: 300 }),
    verifyCode: vi.fn().mockResolvedValue({ valid: true }),
  }),
}));

// Mock db - 只 mock user.findUnique（refresh 端点只查 user）
const { userFindUnique } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
}));
vi.mock('../src/shared/db', () => ({
  db: {
    user: {
      findUnique: userFindUnique,
    },
  },
}));

// 设置 JWT secrets（beforeEach 之前）
process.env.JWT_ACCESS_SECRET = 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-characters-long';

import { AuthService } from '../src/modules/auth/auth.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { JwtService } from '@nestjs/jwt';

describe('AuthController.refresh - W7-fix P0 安全检查', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    // 真实 JwtService（signAsync/verifyAsync 是纯函数）
    const jwt = new JwtService({});
    authService = new AuthService(jwt);
    controller = new AuthController(authService);
  });

  it('SUSPENDED 用户 refresh -> E-USER-005', async () => {
    // signRefreshToken 不查 DB（只签 JWT），所以只需 mock 一次 refresh 时的 findUnique
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'SUSPENDED',
      passwordChangedAt: null,
    });

    await expect(controller.refresh({ refreshToken })).rejects.toMatchObject({
      response: { code: 'E-USER-005' },
    });
  });

  it('DELETED 用户 refresh -> E-USER-005', async () => {
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'DELETED',
      passwordChangedAt: null,
    });

    await expect(controller.refresh({ refreshToken })).rejects.toMatchObject({
      response: { code: 'E-USER-005' },
    });
  });

  it('密码重置后旧 refreshToken refresh -> E-AUTH-006', async () => {
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    // passwordChangedAt 比 token iat 晚 1 秒
    const passwordChangedAt = new Date(Date.now() + 1000);
    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordChangedAt,
    });

    await expect(controller.refresh({ refreshToken })).rejects.toMatchObject({
      response: { code: 'E-AUTH-006' },
    });
  });

  it('密码重置前签发的旧 token 被拒（passwordChangedAt 比 token iat 晚）', async () => {
    const { token: oldToken } = await authService.signRefreshToken('u-1', 'client_app');

    const passwordChangedAt = new Date(Date.now() + 2000);
    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordChangedAt,
    });

    await expect(controller.refresh({ refreshToken: oldToken })).rejects.toMatchObject({
      response: { code: 'E-AUTH-006' },
    });
  });

  it('ACTIVE 用户 + passwordChangedAt 为 null -> 正常刷新', async () => {
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordChangedAt: null,
    });

    const result = await controller.refresh({ refreshToken });
    expect(result.success).toBe(true);
    expect(result.data.accessToken).toBeTruthy();
    expect(result.data.refreshToken).toBeTruthy();
  });

  it('token.iat 晚于 passwordChangedAt -> 正常刷新', async () => {
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    // passwordChangedAt 早于 token iat（密码很久以前改的，token 是新签的）
    userFindUnique.mockResolvedValueOnce({
      id: 'u-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      passwordChangedAt: new Date(Date.now() - 86400000), // 1 天前
    });

    const result = await controller.refresh({ refreshToken });
    expect(result.success).toBe(true);
  });

  it('用户不存在 -> E-USER-001', async () => {
    const { token: refreshToken } = await authService.signRefreshToken('u-1', 'client_app');

    userFindUnique.mockResolvedValueOnce(null);

    await expect(controller.refresh({ refreshToken })).rejects.toMatchObject({
      response: { code: 'E-USER-001' },
    });
  });
});
