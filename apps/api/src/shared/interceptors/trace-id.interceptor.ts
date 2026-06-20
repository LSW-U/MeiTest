/**
 * TraceId 拦截器：每个请求注入 traceId
 *
 * 决策依据：D4-T1 acceptance — 所有请求带 X-Trace-Id header；Sentry 贯穿
 *
 * 用法（被审计/日志/Sentry 共用）：
 *   const traceId = request.headers['x-trace-id'] ?? genId();
 *   response.setHeader('X-Trace-Id', traceId);
 *   request.traceId = traceId; // 后续 logger / Sentry 直接读
 */
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { genId } from '@meimart/shared-utils';

const TRACE_ID_HEADER = 'x-trace-id';

declare module 'http' {
  interface IncomingMessage {
    traceId?: string;
  }
}

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const incoming = request.headers[TRACE_ID_HEADER];
    const traceId = typeof incoming === 'string' && incoming.length > 0 ? incoming : genId();

    request.traceId = traceId;
    response.setHeader('X-Trace-Id', traceId);

    return next.handle();
  }
}
