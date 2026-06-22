/**
 * pino logger（结构化日志 + 敏感字段 mask + traceId 自动注入）
 *
 * 决策依据：CLAUDE.md §日志规范 + §技术栈（监控 Sentry + pino）
 *
 * 字段规范：
 *   required: timestamp, level, traceId, userId?, action
 *   sampled : request_body, response_body (only debug)
 *   mask    : password/token/authorization/secret/apiKey → [REDACTED]
 *             phone/telephone/idCard → ***1234（last 4）
 *
 * traceId 自动注入：mixin 调 getTraceId()（AsyncLocalStorage），无需手写
 */
import pino, { type Logger, type LogFn } from 'pino';
import { getTraceId } from './trace-context';

const globalForLogger = globalThis as unknown as { __meimartLogger?: Logger };

/** 全字段 mask（password/token/secret 等） */
const FULL_REDACT_KEYS = ['password', 'token', 'authorization', 'secret', 'apikey', 'clientsecret'];
/**
 * 部分脱敏（last 4 digits/chars）
 *
 * 含 email：邮箱地址同属 PII，按 last-4 mask（不完美但避免原文写日志）
 * 完整邮箱脱敏（***@domain.com）按需后续优化
 */
const LAST4_KEYS = ['phone', 'telephone', 'idcard', 'mobile', 'email'];

/**
 * 递归 mask 对象（精确小写匹配，WeakSet 防循环引用）
 */
function maskObject(obj: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (obj === null || typeof obj !== 'object') return obj;
  if (seen.has(obj as object)) return '[Circular]';
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    return obj.map((v) => maskObject(v, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lowerK = k.toLowerCase();
    if (FULL_REDACT_KEYS.includes(lowerK)) {
      result[k] = '[REDACTED]';
    } else if (LAST4_KEYS.includes(lowerK)) {
      const s = String(v ?? '');
      result[k] = s.length <= 4 ? '***' : `***${s.slice(-4)}`;
    } else if (v !== null && typeof v === 'object') {
      result[k] = maskObject(v, seen);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** 包装 pino log 方法，自动 mask 参数 */
function wrapWithMask(baseLogger: Logger, level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal'): LogFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = (baseLogger[level] as (...args: any[]) => void).bind(baseLogger);
  return ((objOrMsg: unknown, msgOrObj?: unknown, ...rest: unknown[]) => {
    if (typeof objOrMsg === 'object' && objOrMsg !== null) {
      const masked = maskObject(objOrMsg);
      return fn(masked, msgOrObj, ...rest);
    }
    return fn(objOrMsg, msgOrObj, ...rest);
  }) as LogFn;
}

function createLogger(): Logger {
  const isProd = process.env.NODE_ENV === 'production';
  const base = pino({
    level: isProd ? 'info' : 'debug',
    // 自动注入 traceId（来自 AsyncLocalStorage，跨 await/BullMQ 自动继承）
    mixin() {
      const traceId = getTraceId();
      return traceId ? { traceId } : {};
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

  // 包装 logger 方法，自动 mask 敏感字段
  return {
    ...base,
    info: wrapWithMask(base, 'info'),
    warn: wrapWithMask(base, 'warn'),
    error: wrapWithMask(base, 'error'),
    debug: wrapWithMask(base, 'debug'),
    trace: wrapWithMask(base, 'trace'),
    fatal: wrapWithMask(base, 'fatal'),
  } as Logger;
}

export const logger: Logger = globalForLogger.__meimartLogger ?? createLogger();

if (process.env.NODE_ENV !== 'production') {
  globalForLogger.__meimartLogger = logger;
}
