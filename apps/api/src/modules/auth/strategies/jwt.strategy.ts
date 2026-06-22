/**
 * JWT Strategy（passport-jwt）
 *
 * - 从 Authorization: Bearer <token> 提取 access token
 * - 校验签名 + 自动注入 request.user = JwtPayload
 * - 不查 Redis 黑名单（accessToken 自然过期，黑名单只管 refresh）
 *
 * 注意：logout 后 accessToken 仍然有效到自然过期（≤ 30d），不能服务端 revoke。
 *      安全敏感场景可改为 access token 也带 jti + Redis 校验（成本是每次请求多 1 次 Redis）。
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Role, DeviceType } from '@meimart/api-contract';
import type { JwtPayload } from '../auth.types';
import { assertJwtSecret } from '../../../shared/auth/assert-jwt-secret';

export interface RequestUser {
  sub: string;
  role: Role;
  deviceType: DeviceType;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // P0-1：长度校验抽到 assertJwtSecret，与 AuthService getter 一致
      // （原 `?? ''` 对空字符串无效，会 verify 静默失败）
      secretOrKey: assertJwtSecret('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<RequestUser> {
    if (!payload.sub || !payload.role || !payload.deviceType) {
      throw new UnauthorizedException({
        code: 'E-AUTH-004',
        message: 'Invalid token payload',
      });
    }
    return { sub: payload.sub, role: payload.role, deviceType: payload.deviceType };
  }
}
