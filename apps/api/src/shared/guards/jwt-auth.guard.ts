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
import { Injectable, ExecutionContext, UnauthorizedException, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../shared/decorators/public.decorator';
import { traceContext } from '../../shared/logger/trace-context';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Inject(Reflector) private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const result = (await super.canActivate(context)) as boolean;

    // M-8: JWT 解析后更新 ALS（注入 userId，BullMQ 后台任务可关联用户）
    const request = context.switchToHttp().getRequest();
    const user = request?.user as RequestUser | undefined;
    if (user) {
      const currentStore = traceContext.getStore();
      if (currentStore) {
        traceContext.enterWith({ ...currentStore, userId: user.sub });
      }
    }

    return result;
  }

  // 泛型 TUser 让 AuthGuard 类型推断工作；运行时实际拿到的就是 RequestUser
  handleRequest<TUser = RequestUser>(err: unknown, user: unknown): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException({
        code: 'E-AUTH-002',
        message: 'Authentication required',
      });
    }
    return user as TUser;
  }
}
