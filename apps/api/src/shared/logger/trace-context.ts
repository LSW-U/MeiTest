/**
 * Trace Context（AsyncLocalStorage）
 *
 * 决策依据：W1-D5-T3 + CLAUDE.md §日志规范
 *   - traceId 贯穿整个请求生命周期（含 Prisma await / Promise 链）
 *   - 解决 D5-T2 遗留问题：AllExceptionsFilter 显示 "no-trace"（JWT strategy 抛错先于 TraceIdInterceptor）
 *
 * 用法：
 *   // 请求入口（middleware / interceptor）
 *   traceContext.enterWith({ traceId });
 *
 *   // 任意位置（含异步链路）
 *   const traceId = getTraceId();
 *
 * BullMQ 后台任务（W2-W5 接入时）：
 *   // Producer: job.data.traceId = getTraceId();
 *   // Worker: traceContext.enterWith({ traceId: job.data.traceId });
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface TraceStore {
  traceId: string;
  /** 可选：userId（JWT 解析后注入） */
  userId?: string;
}

export const traceContext = new AsyncLocalStorage<TraceStore>();

/** 读取当前 traceId（异步链路自动继承） */
export function getTraceId(): string | undefined {
  return traceContext.getStore()?.traceId;
}

/** 读取当前 userId（如有） */
export function getTraceUserId(): string | undefined {
  return traceContext.getStore()?.userId;
}

/** 进入 trace 上下文（请求入口调用） */
export function enterTraceContext(store: TraceStore): void {
  traceContext.enterWith(store);
}
