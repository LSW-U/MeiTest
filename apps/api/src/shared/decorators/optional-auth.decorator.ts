/**
 * OptionalAuth 装饰器（个性化推荐批1 2026-10-17）
 *
 * 标记路由"可选登录"：带有效 token 则 req.user 注入，无/无效 token 降级匿名（不 401）。
 * 与 @Public() 区别：Public 完全跳过 passport 校验（user 永不填充）；
 * OptionalAuth 仍跑校验，仅吞掉失败异常。
 *
 * guard 侧行为见 jwt-auth.guard.ts 的 OPTIONAL_AUTH_KEY 分支（try/catch 包 super.canActivate，
 * handleRequest 对无 user 抛 401 由 catch 吞掉）。
 */
import { SetMetadata } from '@nestjs/common';

export const OPTIONAL_AUTH_KEY = 'optionalAuth';

export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
