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
import { OPTIONAL_AUTH_KEY } from '../../shared/decorators/optional-auth.decorator';
import { traceContext } from '../../shared/logger/trace-context';
import type { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(@Inject(Reflector) private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext) {
    // 可选登录（个性化推荐批1）：跑 passport 校验但失败降级匿名（不 401）。
    // Why 不走 super + handleRequest：handleRequest 对无 user 抛 401；这里 try/catch 包住
    // 整个 super.canActivate，无效 token/无 token 均吞掉，req.user 保持 undefined。
    // 未标记路由零变化（仍走下方 super 正常路径）。
    // ⚠️ optional 检查须在 public 之前：ClientProductController 类级 @Public()，方法级
    //   @OptionalAuth 要覆盖它（getAllAndOverride(IS_PUBLIC) 仍会从类上读到 true 短路）。
    const isOptional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isOptional) {
      try {
        await super.canActivate(context);
      } catch {
        return true; // 匿名降级
      }
      // 校验成功：补 M-8 ALS 注入后返回（与下方主路径同语义）
      const reqOptional = context.switchToHttp().getRequest();
      const userOptional = reqOptional?.user as RequestUser | undefined;
      if (userOptional) {
        const store = traceContext.getStore();
        if (store) {
          traceContext.enterWith({ ...store, userId: userOptional.sub });
        }
      }
      return true;
    }

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
