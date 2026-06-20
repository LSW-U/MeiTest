/**
 * JWT Auth Guard（基于 passport-jwt strategy）
 *
 * 用法：
 *   @UseGuards(JwtAuthGuard)
 *   @Controller('protected')
 *   class FooController {}
 *
 * 或全局：
 *   APP_GUARD: JwtAuthGuard（所有端点默认需要登录，公开端点用 @Public()）
 */
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../shared/decorators/public.decorator';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  // 泛型 TUser 让 AuthGuard 类型推断工作；运行时实际拿到的就是 RequestUser
  handleRequest<TUser = RequestUser>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException({
        code: 'E-AUTH-UNAUTHORIZED',
        message: 'Authentication required',
      });
    }
    return user as TUser;
  }
}
