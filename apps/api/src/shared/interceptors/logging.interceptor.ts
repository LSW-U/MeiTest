/**
 * Logging 拦截器：每个请求记录 method/url/status/耗时/userId/traceId/action
 *
 * 决策依据：D4-T1 + D5-T3 — required fields [timestamp, level, traceId, userId?, action]
 *                                  sampled [request_body, response_body] (only debug)
 *
 * 工作流：
 *   1. 从 @Action() 装饰器读 action（无则用 Controller.handler 推断）
 *   2. debug 级别采样 request_body（仅写操作）
 *   3. response_body 在 next(val) 拿到（debug 级别记录）
 *   4. logger.info 含 action + 全部字段
 *
 * 用法（注册全局 + controller 标注）：
 *   @Post('login')
 *   @Action('auth.login')
 *   async login(...) {}
 */
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Inject } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Reflector } from '@nestjs/core';
import { logger } from '../logger/logger';
import { ACTION_KEY } from '../decorators/action.decorator';
import { getTraceId } from '../logger/trace-context';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const MAX_BODY_LOG_LENGTH = 2000; // 防止大 body 撑爆日志

/** 截断 body（防止日志爆炸） */
function truncateBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return body.length > MAX_BODY_LOG_LENGTH ? `${body.slice(0, MAX_BODY_LOG_LENGTH)}...[truncated]` : body;
  }
  return body;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url } = request;
    const userId = request.user?.sub as string | undefined;
    const startTime = Date.now();

    // action 来源优先级：@Action() metadata > Controller.handler 推断
    const declaredAction = this.reflector.getAllAndOverride<string | undefined>(ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const controllerName = context.getClass()?.name?.replace(/Controller$/, '') ?? 'Unknown';
    const handlerName = context.getHandler()?.name ?? 'unknown';
    const action = declaredAction ?? `${controllerName}.${handlerName}`;

    // 仅写操作 + debug 级别采样 request_body
    const isDebug = logger.level === 'debug';
    const isWrite = WRITE_METHODS.has(method.toUpperCase());
    const requestBody = isDebug && isWrite ? truncateBody(request.body) : undefined;

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          // traceId 优先从 ALS（更可靠，interceptor 之外的 logger 调用也用 ALS）
          const traceId = getTraceId() ?? (request.traceId as string | undefined);
          logger.info({
            msg: 'request',
            method,
            url,
            action,
            statusCode: response.statusCode,
            durationMs: Date.now() - startTime,
            ...(userId && { userId }),
            ...(traceId && { traceId }),
            ...(requestBody !== undefined && { requestBody }),
            ...(isDebug && { responseBody: truncateBody(responseData) }),
          });
        },
        error: (err: unknown) => {
          const traceId = getTraceId() ?? (request.traceId as string | undefined);
          logger.warn({
            msg: 'request_error',
            method,
            url,
            action,
            error: (err as { message?: string })?.message ?? String(err),
            durationMs: Date.now() - startTime,
            ...(userId && { userId }),
            ...(traceId && { traceId }),
            ...(requestBody !== undefined && { requestBody }),
          });
        },
      }),
    );
  }
}
