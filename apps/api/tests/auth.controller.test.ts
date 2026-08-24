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
  createRefreshSession: vi.fn().mockResolvedValue(undefined),
  consumeRefreshSession: vi.fn().mockResolvedValue({
    status: 'OK',
    session: {
      familyId: 'family-1',
      userId: 'u-1',
      status: 'active',
      deviceType: 'client_app',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    },
  }),
  revokeFamily: vi.fn().mockResolvedValue(undefined),
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
  isSessionValid: vi.fn().mockResolvedValue(true),
  getRefreshSession: vi.fn().mockResolvedValue({ familyId: 'family-1' }),
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
import { consumeRefreshSession } from '../src/shared/cache';
import 'reflect-metadata';
import { ROLES_KEY } from '../src/shared/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../src/shared/decorators/public.decorator';
import type { Role } from '@meimart/api-contract';

describe('AuthController.refresh - W7-fix P0 安全检查', () => {
  let controller: AuthController;
  let authService: AuthService;

  beforeEach(() => {
    vi.resetAllMocks();
    // v1.2：resetAllMocks 后重设 consumeRefreshSession 默认返回 OK
    vi.mocked(consumeRefreshSession).mockResolvedValue({
      status: 'OK',
      session: {
        familyId: 'family-1',
        userId: 'u-1',
        status: 'active',
        deviceType: 'client_app',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60000,
      },
    });
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

/**
 * v5 修复（2026-08-25）回归：change-password / change-phone 必须声明 @Roles
 *
 * 背景：RolesGuard 全局 least-privilege —— 端点未声明 @Roles 且未声明 @Public 时
 * 默认抛 E-AUTH-008 拒绝（roles.guard.ts:37-43）。change-password/change-phone 原仅
 * 挂 @Audit + @RateLimit，导致所有登录态角色被拒（客户/骑手/仓库/客服/super_admin 都调不了）。
 *
 * 本用例断言两个 handler 的元数据已声明全部 5 个登录态角色，防止「忘加 @Roles」回归。
 * RolesGuard 的拒绝逻辑本身由 roles.guard.test.ts 覆盖，此处只校验装饰器元数据存在。
 */
describe('AuthController.changePassword/changePhone - @Roles 装饰器回归（v5 修复 2026-08-25）', () => {
  const EXPECTED_ROLES: Role[] = [
    'CUSTOMER',
    'RIDER',
    'WAREHOUSE_STAFF',
    'CUSTOMER_SERVICE',
    'SUPER_ADMIN',
  ];

  it('changePassword 声明全部登录态角色（非 @Public）', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AuthController.prototype.changePassword,
    ) as Role[] | undefined;
    expect(roles).toEqual(EXPECTED_ROLES);

    // 确保未误挂 @Public（@Public 会绕过 RolesGuard，违背登录态鉴权意图）
    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      AuthController.prototype.changePassword,
    );
    expect(isPublic).toBeFalsy();
  });

  it('changePhone 声明全部登录态角色（非 @Public）', () => {
    const roles = Reflect.getMetadata(
      ROLES_KEY,
      AuthController.prototype.changePhone,
    ) as Role[] | undefined;
    expect(roles).toEqual(EXPECTED_ROLES);

    const isPublic = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      AuthController.prototype.changePhone,
    );
    expect(isPublic).toBeFalsy();
  });
});
