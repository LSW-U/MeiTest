/**
 * TraceId Interceptor：保留向后兼容（已迁移到 Middleware，此文件仅注入 request.traceId 给 ALS）
 *
 * 决策依据：D5-T3 — Middleware 解决 Guard 抛错拿不到 traceId 问题后，
 *          Interceptor 不再做实际工作，但保留以兼容现有引用
 */
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';

declare module 'http' {
  interface IncomingMessage {
    traceId?: string;
  }
}

@Injectable()
export class TraceIdInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // TraceIdMiddleware 已在请求最早期注入 ALS + request.traceId
    // 此 Interceptor 仅为兼容性保留，不做实际工作
    return next.handle();
  }
}
