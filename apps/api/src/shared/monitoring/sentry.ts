/**
 * Sentry 集成（错误追踪 + traceId 贯穿）
 *
 * 决策依据：CLAUDE.md §技术栈（监控 Sentry + pino）+ W1 完成判据 L305
 *
 * 用法：
 *   - main.ts 启动时调 initSentry()
 *   - AllExceptionsFilter 用 captureException(exception) 上报未捕获异常
 *   - traceId 通过 Sentry.setTag('traceId', getTraceId()) 自动贯穿
 *
 * 无 SENTRY_DSN 时跳过初始化（dev 不上报）
 */
import * as Sentry from '@sentry/node';
import { getTraceId } from '../logger/trace-context';
import { logger } from '../logger/logger';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.warn({ msg: 'sentry_skipped', reason: 'SENTRY_DSN not set' });
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '1.0'),
    profilesSampleRate: 1.0,
    integrations: [],
    beforeSend(event) {
      // 自动注入 traceId 到 Sentry 事件（与 pino 日志关联）
      const traceId = getTraceId();
      if (traceId) {
        event.tags = { ...event.tags, traceId };
      }
      return event;
    },
  });

  logger.info({ msg: 'sentry_initialized', env: process.env.NODE_ENV });
}

/**
 * 捕获异常到 Sentry（AllExceptionsFilter 用）
 *
 * 仅在 SENTRY_DSN 已设时上报（dev 不上报）
 */
export function captureException(exception: unknown): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.captureException(exception);
}

export { Sentry };
