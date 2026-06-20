/**
 * Logging 拦截器：每个请求记录 method/url/status/耗时/userId/traceId
 *
 * 决策依据：D4-T1 acceptance + CLAUDE.md §可观测（pino 结构化日志）
 */
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { logger } from '../logger/logger';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const traceId = request.traceId as string | undefined;
    const userId = request.user?.sub as string | undefined;
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          logger.info({
            msg: 'request',
            method,
            url,
            statusCode: response.statusCode,
            durationMs: Date.now() - startTime,
            traceId,
            userId,
          });
        },
        error: (err) => {
          logger.warn({
            msg: 'request_error',
            method,
            url,
            error: err?.message ?? String(err),
            durationMs: Date.now() - startTime,
            traceId,
            userId,
          });
        },
      }),
    );
  }
}
