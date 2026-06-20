/**
 * Roles Guard（5 角色 RBAC）
 *
 * 决策依据：契约 v0.3 决策 7 — 后端 RBAC 不感知 perspective，只看 role
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('super_admin')
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';
import type { Role } from '@meimart/api-contract';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // 未声明 @Roles() → 任何已登录用户都允许（只验证 JwtAuthGuard）
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user) {
      throw new ForbiddenException({
        code: 'E-AUTH-FORBIDDEN',
        message: 'No authenticated user',
      });
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        code: 'E-AUTH-ROLE-INSUFFICIENT',
        message: `Role '${user.role}' is not allowed. Required: ${requiredRoles.join(' | ')}`,
        details: { requiredRoles, currentRole: user.role },
      });
    }

    return true;
  }
}
