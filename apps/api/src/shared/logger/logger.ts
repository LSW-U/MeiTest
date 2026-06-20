/**
 * pino logger（结构化日志 + 敏感字段 mask）
 *
 * 决策依据：CLAUDE.md §技术栈（监控 Sentry + pino）
 *
 * 后续 D5-T3 完善时统一字段：
 *   required: timestamp, level, traceId, userId?, action
 *   sampled:  request_body, response_body (only debug)
 *   mask:     password, token, phone(last 4), idCard(last 4)
 */
import pino, { type Logger } from 'pino';

const globalForLogger = globalThis as unknown as { __meimartLogger?: Logger };

const SENSITIVE_KEYS = ['password', 'token', 'authorization', 'secret', 'apiKey'];
const PHONE_KEYS = ['phone', 'telephone'];

function redactPaths(): string[] {
  return [
    ...SENSITIVE_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
    ...PHONE_KEYS.flatMap((k) => [k, `*.${k}`]),
  ];
}

function createLogger(): Logger {
  const isProd = process.env.NODE_ENV === 'production';
  return pino({
    level: isProd ? 'info' : 'debug',
    redact: {
      paths: redactPaths(),
      censor: '[REDACTED]',
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
  });
}

export const logger: Logger = globalForLogger.__meimartLogger ?? createLogger();
if (process.env.NODE_ENV !== 'production') {
  globalForLogger.__meimartLogger = logger;
}
