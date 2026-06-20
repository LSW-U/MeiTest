/**
 * JWT 类型定义（v0.3 决策 C + E）
 *
 * payload: { sub, role, deviceType, iat, exp, jti } — 无 clientType
 *
 * 分端 TTL：
 *   - client_app access 30d / refresh 60d
 *   - rider_app  access 12h / refresh 60d
 *   - admin_web  access 2h  / refresh 60d
 *
 * logout: refresh 加 Redis 黑名单 blacklist:{jti}，accessToken 自然过期
 */
import type { Role, DeviceType } from '@meimart/api-contract';

export interface JwtPayload {
  /** userId */
  sub: string;
  role: Role;
  deviceType: DeviceType;
  iat?: number;
  exp?: number;
  /** JWT ID，用于 logout 黑名单定位（仅 refresh token 含） */
  jti?: string;
}

export type TokenType = 'access' | 'refresh';

/** 分端 access TTL（秒） */
export const ACCESS_TTL_SECONDS: Record<DeviceType, number> = {
  client_app: 30 * 24 * 60 * 60, // 30 天
  rider_app: 12 * 60 * 60, // 12 小时
  admin_web: 2 * 60 * 60, // 2 小时
};

/** refresh 统一 60 天 */
export const REFRESH_TTL_SECONDS = 60 * 24 * 60 * 60;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number; // unix 秒
  refreshExpiresAt: number;
}
