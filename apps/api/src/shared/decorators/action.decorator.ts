/**
 * @Action() 装饰器：标记 controller 方法的业务 action
 *
 * 决策依据：W1-D5-T3 — 日志 required_fields 含 action
 *
 * 用法：
 *   @Post('login')
 *   @Action('auth.login')
 *   async login(...) {}
 *
 * LoggingInterceptor 读 @Action() metadata，无则 fallback 用 Controller.handler 推断
 */
import { SetMetadata } from '@nestjs/common';

export const ACTION_KEY = 'action';
export const Action = (action: string) => SetMetadata(ACTION_KEY, action);
