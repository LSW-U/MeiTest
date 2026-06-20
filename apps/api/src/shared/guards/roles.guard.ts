/**
 * Roles Guard（5 角色 RBAC）
 *
 * 决策依据：契约 v0.3 决策 7 — 后端 RBAC 不感知 perspective，只看 role
 *
 * 默认 least privilege：未声明 @Roles() 的端点拒绝访问（防业务 controller 忘加）
 * 公开端点必须显式 @Public()（如 /health、/auth/login）
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard, DeviceTypeGuard, RolesGuard)
 *   @Roles('super_admin')
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';
import type { Role } from '@meimart/api-contract';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // @Public() 端点直接放行（JwtAuthGuard 已处理）
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // least privilege：未声明 @Roles() 默认拒绝（防业务 controller 忘加）
    if (!requiredRoles || requiredRoles.length === 0) {
      throw new ForbiddenException({
        code: 'E-AUTH-ROLES-NOT-DECLARED',
        message: 'Endpoint must declare @Roles(...) or @Public()',
      });
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
