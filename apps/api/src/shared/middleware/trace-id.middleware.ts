/**
 * TraceId Middleware：在 Guard / Interceptor 之前注入 traceId + ALS
 *
 * 决策依据：NestJS 执行顺序 Middleware → Guard → Interceptor → Handler
 *          之前用 TraceIdInterceptor 注入 ALS，但 Guard 抛错时 Interceptor 还没跑，
 *          AllExceptionsFilter 拿不到 traceId（显示 "no-trace"）。
 *
 * 改用 Middleware 后，traceId 在请求最早期注入 ALS，
 * 后续 Guard 抛错时 filter 也能拿到 traceId。
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { genId } from '@meimart/shared-utils';
import { enterTraceContext } from '../logger/trace-context';

const TRACE_ID_HEADER = 'x-trace-id';

// M-9: 全局扩展 Express Request 类型，避免每处访问 request.traceId 都要 as 断言
declare module 'express' {
  interface Request {
    traceId?: string;
  }
}

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[TRACE_ID_HEADER];
    const traceId = typeof incoming === 'string' && incoming.length > 0 ? incoming : genId();

    // 注入 request.traceId（全局类型扩展后无需 as 断言）
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);

    // 进入 ALS 上下文（Guard / Interceptor / Handler / Filter 都能拿 traceId）
    enterTraceContext({ traceId });

    next();
  }
}
