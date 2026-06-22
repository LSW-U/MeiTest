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
import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { genId } from '@meimart/shared-utils';
import type { Role, DeviceType } from '@meimart/api-contract';
import {
  JwtPayload,
  TokenPair,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
} from './auth.types';
import { blacklistJti, isBlacklisted } from '../../shared/cache';
import { assertJwtSecret } from '../../shared/auth/assert-jwt-secret';

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

  /** 签发 refresh token（统一 60d，含 jti 用于 logout 黑名单） */
  async signRefreshToken(
    userId: string,
    deviceType: DeviceType,
  ): Promise<{ token: string; jti: string; expiresIn: number }> {
    const jti = genId();
    const expiresIn = REFRESH_TTL_SECONDS;
    const payload: RefreshPayload = { sub: userId, deviceType, jti };
    const token = await this.jwt.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn,
    });
    return { token, jti, expiresIn };
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
   * 校验 refresh token（必须不在黑名单中）
   *
   * 返回 jti 用于后续逻辑（如续签时新生成 jti）
   */
  async verifyRefreshToken(token: string): Promise<{ payload: RefreshPayload; jti: string }> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(token, { secret: this.refreshSecret });
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
    if (await isBlacklisted(payload.jti)) {
      throw new UnauthorizedException({
        code: 'E-AUTH-006',
        message: 'Refresh token has been revoked',
      });
    }
    return { payload, jti: payload.jti };
  }

  /**
   * Logout：把 refresh token 的 jti 加入黑名单
   *
   * accessToken 自然过期（不能服务端 revoke，等过期或 refresh）。
   */
  async logout(refreshToken: string): Promise<string> {
    const { payload, jti } = await this.verifyRefreshToken(refreshToken);
    const ttlSeconds = payload.exp
      ? payload.exp - Math.floor(Date.now() / 1000)
      : REFRESH_TTL_SECONDS;
    if (ttlSeconds > 0) {
      await blacklistJti(jti, ttlSeconds);
    }
    return jti;
  }

  private get accessSecret(): string {
    // P0-1：抽到 assertJwtSecret，与 JwtStrategy 构造函数共享校验逻辑
    return assertJwtSecret('JWT_ACCESS_SECRET');
  }

  private get refreshSecret(): string {
    return assertJwtSecret('JWT_REFRESH_SECRET');
  }
}
