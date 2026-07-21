/**
 * JWT 服务（签发 + 校验 + logout 黑名单）
 *
 * 决策依据：v0.3 决策 C（payload 字段）+ E（分端 TTL）+ F（logout 黑名单）
 *
 * 关键 API：
 *   - signAccessToken(userId, role, deviceType): { token, expiresIn }
 *   - signRefreshToken(userId, deviceType): { token, jti, expiresIn }
 *   - verifyAccessToken(token): JwtPayload
 *   - verifyRefreshToken(token): { payload, jti }（检查 Redis 黑名单）
 *   - logout(refreshToken): 把 jti 加入 Redis 黑名单（TTL = refresh 剩余有效期）
 */
import { Injectable, UnauthorizedException, Inject, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { genId } from '@meimart/shared-utils';
import type { Role, DeviceType } from '@meimart/api-contract';
import {
  JwtPayload,
  TokenPair,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
} from './auth.types';
import {
  createRefreshSession,
  consumeRefreshSession,
  revokeFamily,
  revokeUserSessions,
  isSessionValid,
  getRefreshSession,
} from '../../shared/cache';
import { assertJwtSecret } from '../../shared/auth/assert-jwt-secret';
import { db } from '../../shared/db';
import { passwordStrategy } from '../../infrastructure/otp/password.strategy';
import { getOtpStrategy } from '../../infrastructure/otp/otp.factory';
import type { OtpScene } from '../../infrastructure/otp/otp-strategy';
import { logger } from '../../shared/logger/logger';

/** Refresh token payload（不含 role，避免权限长期暴露） */
interface RefreshPayload {
  sub: string;
  deviceType: DeviceType;
  jti: string;
  /** JWT 标准字段，verify 时由 jsonwebtoken 注入 */
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  /** 签发 access token（短 TTL，按 deviceType） */
  async signAccessToken(
    userId: string,
    role: Role,
    deviceType: DeviceType,
  ): Promise<{ token: string; expiresIn: number }> {
    const expiresIn = ACCESS_TTL_SECONDS[deviceType];
    const payload: JwtPayload = { sub: userId, role, deviceType };
    const token = await this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn,
    });
    return { token, expiresIn };
  }

  /**
   * 签发 refresh token（统一 60d，含 jti 用于 Token Family）
   *
   * Token Family（v1.2）：每次登录生成新 familyId，该会话所有 refresh token 共享。
   * 刷新时传入旧 familyId，保持会话连续性。旧 token 重放时撤销整个 family。
   *
   * @param familyId 登录不传（生成新），刷新传入旧 familyId 保持会话族
   */
  async signRefreshToken(
    userId: string,
    deviceType: DeviceType,
    familyId?: string,
  ): Promise<{ token: string; jti: string; expiresIn: number; familyId: string }> {
    const fid = familyId ?? genId();
    const jti = genId();
    const expiresIn = REFRESH_TTL_SECONDS;
    const payload: RefreshPayload = { sub: userId, deviceType, jti };
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn,
    });
    // Token Family：写 Redis session（active 状态）
    const expiresAt = Date.now() + expiresIn * 1000;
    await createRefreshSession({ jti, familyId: fid, userId, deviceType, expiresAt });
    return { token, jti, expiresIn, familyId: fid };
  }

  /** 签发完整 token pair（登录 / refresh 流程用） */
  async signTokenPair(
    userId: string,
    role: Role,
    deviceType: DeviceType,
  ): Promise<TokenPair> {
    const access = await this.signAccessToken(userId, role, deviceType);
    const refresh = await this.signRefreshToken(userId, deviceType);
    const now = Math.floor(Date.now() / 1000);
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      accessExpiresAt: now + access.expiresIn,
      refreshExpiresAt: now + refresh.expiresIn,
    };
  }

  /** 校验 access token（不查 Redis 黑名单，accessToken 自然过期） */
  async verifyAccessToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token, { secret: this.accessSecret });
    } catch {
      throw new UnauthorizedException({
        code: 'E-AUTH-003',
        message: 'Access token expired or invalid',
      });
    }
  }

  /**
   * 校验 refresh token（轻量检查，不消费。logout 用）
   *
   * 验 JWT 签名 + isSessionValid（只读）。返回 session 供 logout 拿 familyId。
   */
  async verifyRefreshToken(token: string): Promise<{
    payload: RefreshPayload;
    jti: string;
    session: { familyId: string } | null;
  }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token invalid or expired',
      });
    }
    if (!payload.jti) {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token missing jti',
      });
    }
    // Token Family：轻量检查 session 有效（不消费）
    if (!(await isSessionValid(payload.jti))) {
      throw new UnauthorizedException({
        code: 'E-AUTH-006',
        message: 'Refresh token has been revoked',
      });
    }
    const session = await getRefreshSession(payload.jti);
    return {
      payload,
      jti: payload.jti,
      session: session ? { familyId: session.familyId } : null,
    };
  }

  /**
   * 原子消费 refresh token（refresh 端点用，v1.2）
   *
   * 调 consumeRefreshSession Lua 脚本，原子标记 used。
   * - OK: 返回 session（含 familyId），可签发新 pair（同 familyId）
   * - INVALID/EXPIRED: token 无效/过期 -> E-AUTH-005
   * - REVOKED/REPLAY: family 已撤销 -> E-AUTH-006（REPLAY 时 family 已被 Lua 撤销）
   *
   * 并发安全：Lua 原子，并发刷新同一旧 jti 只一个 OK，另一个 REPLAY。
   */
  async consumeRefreshToken(token: string): Promise<{
    payload: RefreshPayload;
    jti: string;
    familyId: string;
    userId: string;
    deviceType: DeviceType;
  }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token invalid or expired',
      });
    }
    if (!payload.jti) {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token missing jti',
      });
    }
    const result = await consumeRefreshSession(payload.jti);
    if (result.status === 'INVALID' || result.status === 'EXPIRED') {
      throw new UnauthorizedException({
        code: 'E-AUTH-005',
        message: 'Refresh token invalid or expired',
      });
    }
    if (result.status === 'REVOKED' || result.status === 'REPLAY') {
      // REPLAY: 旧 token 重放，family 已被 Lua 撤销
      throw new UnauthorizedException({
        code: 'E-AUTH-006',
        message: 'Refresh token has been revoked',
      });
    }
    // OK: result.session
    const session = result.session;
    return {
      payload,
      jti: payload.jti,
      familyId: session.familyId,
      userId: session.userId,
      deviceType: session.deviceType as DeviceType,
    };
  }

  /**
   * Logout：撤销整个 refresh family（v1.2 Token Family）
   *
   * 该登录会话的所有 refresh token 失效（不只当前 jti）。
   * accessToken 自然过期（不能服务端 revoke）。
   */
  async logout(refreshToken: string): Promise<string | null> {
    const { session } = await this.verifyRefreshToken(refreshToken);
    if (session) {
      await revokeFamily(session.familyId);
    }
    return session?.familyId ?? null;
  }

  private get accessSecret(): string {
    // P0-1：抽到 assertJwtSecret，与 JwtStrategy 构造函数共享校验逻辑
    return assertJwtSecret('JWT_ACCESS_SECRET');
  }

  private get refreshSecret(): string {
    return assertJwtSecret('JWT_REFRESH_SECRET');
  }

  // ==========================================================================
  // W 流程业务方法（密码 + SMS 登录注册，2026-06-24 加）
  // ==========================================================================

  /** 按 role 推断 deviceType（前端不传 deviceType，服务端推断更安全） */
  inferDeviceTypeFromRole(role: Role): DeviceType {
    switch (role) {
      case 'customer':
        return 'client_app';
      case 'rider':
        return 'rider_app';
      case 'super_admin':
      case 'warehouse_staff':
      case 'customer_service':
        return 'admin_web';
    }
  }

  /** contract DeviceType (lowercase) → Prisma DeviceType enum (UPPERCASE) */
  private toPrismaDeviceType(deviceType: DeviceType): 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB' | 'SYSTEM' {
    switch (deviceType) {
      case 'client_app':
        return 'CLIENT_APP';
      case 'rider_app':
        return 'RIDER_APP';
      case 'admin_web':
        return 'ADMIN_WEB';
      case 'system':
        return 'SYSTEM';
    }
  }

  /**
   * Prisma role（大写 enum：SUPER_ADMIN / CUSTOMER / ...）→ contract role（小写 union）
   *
   * W2-W 决策（2026-06-24）：DB schema 用大写 enum（Prisma 默认），contract schema 用小写
   * （前端期望小写），在 service 边界做一次映射，所有 module 复用此 helper。
   */
  toContractRole(prismaRole: string): Role {
    return prismaRole.toLowerCase() as Role;
  }

  /** 密码登录：找 user + verify password + 签 token pair
   *
   * 安全：E-USER-001/002 不区分「手机号未注册」vs「密码错」，统一返回 E-USER-006
   * 避免攻击者通过错误码差异枚举已注册手机号（东帝汶市场小，手机号段有限，风险高）。
   * 注：MVP 阶段不做时间侧信道 dummy verify（bcrypt 复杂度已足够），W6 切真 SMS 时一并加固。
   */
  async loginWithPassword(phone: string, password: string): Promise<TokenPair & { userId: string; role: Role }> {
    const GENERIC_AUTH_FAIL = {
      code: 'E-USER-006',
      message: 'Phone or password invalid',
    } as const;

    const user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      throw new UnauthorizedException(GENERIC_AUTH_FAIL);
    }
    if (user.status !== 'ACTIVE') {
      // 用户禁用：也是「无法登录」，但攻击者已知手机号注册了；返回 E-USER-005 暴露注册状态可接受（禁用 = 主动禁用）
      throw new UnauthorizedException({
        code: 'E-USER-005',
        message: `User status is ${user.status}, login disabled`,
      });
    }
    const ok = await passwordStrategy.verifyPassword(user.password, password);
    if (!ok) {
      throw new UnauthorizedException(GENERIC_AUTH_FAIL);
    }

    const deviceType = this.inferDeviceTypeFromRole(this.toContractRole(user.role));
    const role = this.toContractRole(user.role);
    const tokenPair = await this.signTokenPair(user.id, role, deviceType);

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastDeviceType: this.toPrismaDeviceType(deviceType) },
    });

    logger.info({
      msg: 'LOGIN_PASSWORD_SUCCESS',
      userId: user.id,
      role,
      deviceType,
    });

    return { ...tokenPair, userId: user.id, role };
  }

  /** SMS 验证码登录：verify code + 找 user（不存在自动创建 customer）+ 签 token pair */
  async loginWithSms(phone: string, smsCode: string): Promise<TokenPair & { userId: string; role: Role }> {
    const verified = await this.verifySmsCode(phone, smsCode, 'LOGIN');
    if (!verified) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }

    let user = await db.user.findUnique({ where: { phone } });
    if (!user) {
      // SMS 登录找不到用户时自动注册（OTP-only onboarding，仅 customer 角色）
      // 安全守卫：仅在 development / test 环境启用，staging/prod 不存在用户时返回 E-USER-006
      // 防止：dev stub 固定验证码 123456 意外暴露到公网时，任意手机号自动开户刷脏用户表
      const nodeEnv = process.env.NODE_ENV || 'development';
      if (nodeEnv !== 'development' && nodeEnv !== 'test') {
        logger.warn({
          msg: 'SMS_LOGIN_AUTO_REGISTER_BLOCKED',
          phone,
          reason: `NODE_ENV=${nodeEnv} (only allowed in development/test)`,
        });
        throw new UnauthorizedException({
          code: 'E-USER-006',
          message: 'Phone or password invalid',
        });
      }
      user = await db.user.create({
        data: {
          phone,
          phoneVerified: true,
          password: await passwordStrategy.hashPassword(genId()), // 随机密码占位
          role: 'CUSTOMER',
          status: 'ACTIVE',
        },
      });
      logger.info({ msg: 'SMS_LOGIN_AUTO_REGISTER', userId: user.id, phone });
    } else if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'E-USER-005',
        message: `User status is ${user.status}, login disabled`,
      });
    }

    if (!user.phoneVerified) {
      await db.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
    }

    const role = this.toContractRole(user.role);
    const deviceType = this.inferDeviceTypeFromRole(role);
    const tokenPair = await this.signTokenPair(user.id, role, deviceType);

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastDeviceType: this.toPrismaDeviceType(deviceType) },
    });

    return { ...tokenPair, userId: user.id, role };
  }

  /** 注册：verify SMS（如传）+ 创建 user + 签 token pair */
  async registerUser(input: {
    phone: string;
    password: string;
    email?: string;
    name?: string;
    smsCode?: string;
  }): Promise<TokenPair & { userId: string; role: Role }> {
    // 校验手机号未被注册
    const existing = await db.user.findUnique({ where: { phone: input.phone } });
    if (existing) {
      throw new ConflictException({
        code: 'E-USER-004',
        message: 'Phone already registered',
      });
    }
    if (input.email) {
      const existingEmail = await db.user.findUnique({ where: { email: input.email } });
      if (existingEmail) {
        throw new ConflictException({
          code: 'E-USER-004',
          message: 'Email already registered',
        });
      }
    }

    // SMS 验证码校验（必传，dev/staging stub 固定 123456）
    if (!input.smsCode) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code required for registration',
      });
    }
    const verified = await this.verifySmsCode(input.phone, input.smsCode, 'REGISTER');
    if (!verified) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }

    const passwordHash = await passwordStrategy.hashPassword(input.password);
    const user = await db.user.create({
      data: {
        phone: input.phone,
        email: input.email ?? null,
        name: input.name ?? null,
        password: passwordHash,
        phoneVerified: true,
        role: 'CUSTOMER',
        status: 'ACTIVE',
      },
    });

    const role = this.toContractRole(user.role);
    const deviceType = this.inferDeviceTypeFromRole(role);
    const tokenPair = await this.signTokenPair(user.id, role, deviceType);

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastDeviceType: this.toPrismaDeviceType(deviceType) },
    });

    logger.info({ msg: 'REGISTER_SUCCESS', userId: user.id, phone: input.phone });

    return { ...tokenPair, userId: user.id, role };
  }

  /** 发 SMS 验证码（stub：固定 123456，标 [SMS_STUB]，W6 切东帝汶本地） */
  async sendSmsCode(phone: string, scene: OtpScene = 'LOGIN'): Promise<{ expireIn: number }> {
    const sms = getOtpStrategy('SMS');
    const result = await sms.sendCode({ target: phone, scene });
    return { expireIn: result.expireIn };
  }

  /** SMS 找回密码：verify SMS + 改密
   *
   * 安全（v1.1 审查补漏）：不区分「用户不存在」vs「SMS code 错」，统一返回 E-USER-003。
   * 防止攻击者通过错误码差异枚举已注册手机号（resetPassword 也是泄漏点）。
   */
  async resetPassword(input: {
    phone: string;
    smsCode: string;
    newPassword: string;
  }): Promise<void> {
    const user = await db.user.findUnique({ where: { phone: input.phone } });
    if (!user) {
      // 不暴露"用户不存在"，统一返回 SMS code 错误码（攻击者无法区分）
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    const verified = await this.verifySmsCode(input.phone, input.smsCode, 'RESET_PASSWORD');
    if (!verified) {
      throw new UnauthorizedException({
        code: 'E-USER-003',
        message: 'SMS code invalid or expired',
      });
    }
    const newHash = await passwordStrategy.hashPassword(input.newPassword);
    // W7-fix（审查 P0 #2）：同步更新 passwordChangedAt，refresh 端点检查 token.iat < passwordChangedAt 拒绝旧 token
    await db.user.update({
      where: { id: user.id },
      data: { password: newHash, passwordChangedAt: new Date() },
    });
    // v1.2 Token Family：密码重置后撤销该用户所有 refresh family（强制全部重新登录）
    await revokeUserSessions(user.id);
    logger.info({ msg: 'PASSWORD_RESET_SUCCESS', userId: user.id });
  }

  /** 内部 helper：包装 SmsStrategy.verifyCode 返回 boolean */
  private async verifySmsCode(phone: string, code: string, scene: OtpScene): Promise<boolean> {
    const sms = getOtpStrategy('SMS');
    const result = await sms.verifyCode({ target: phone, code, scene });
    return result.valid;
  }
}
