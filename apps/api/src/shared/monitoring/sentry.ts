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
 *
 * 采样率（M-8 修复）：
 *   - dev 默认 0.0（避免本地调试耗尽 Sentry 免费配额 5k events/月）
 *   - prod 默认 1.0（生产全采样，便于追踪问题）
 *   - 显式 SENTRY_TRACES_SAMPLE_RATE 覆盖
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

  const isProd = process.env.NODE_ENV === 'production';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // M-8：dev 默认 0.0（防止本地调试耗尽 Sentry 免费配额），prod 默认 1.0
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? (isProd ? '1.0' : '0.0')),
    profilesSampleRate: isProd ? 1.0 : 0.0,
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

  logger.info({
    msg: 'sentry_initialized',
    env: process.env.NODE_ENV,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE ?? (isProd ? 1.0 : 0.0),
  });
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
