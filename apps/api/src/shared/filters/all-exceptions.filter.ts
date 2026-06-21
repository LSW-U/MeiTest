/**
 * 全局异常过滤器：统一错误响应格式 + Accept-Language 本地化
 *
 * 决策依据：D4-T1 + D5-T2 — 异常返回统一结构 { code, message, traceId, i18nKey }
 *
 * 响应格式：
 *   {
 *     success: false,
 *     error: {
 *       code: "E-AUTH-001",
 *       message: "本地化后的友好提示",  // 按 Accept-Language 查 shared-locales/errors
 *       traceId: "uuid",
 *       i18nKey?: "errors.E-AUTH-001"
 *     }
 *   }
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { detectLanguage } from '@meimart/shared-utils';
import { errorBundles, DEFAULT_LOCALE, type Locale } from '@meimart/shared-locales';
import { logger } from '../logger/logger';

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    traceId: string;
    i18nKey?: string;
    details?: unknown;
  };
}

/**
 * 按 Accept-Language 查错误码本地化 message
 *
 * fallback 链：lang → en → 原始 message
 * 用 `||` 而非 `??`（空字符串也是 falsy，Tetum errors.json 空值时 fallback）
 */
function localizeErrorMessage(code: string, originalMessage: string, acceptLanguage: string | undefined): string {
  const lang = detectLanguage(acceptLanguage) as Locale;
  const bundle = errorBundles[lang] ?? errorBundles[DEFAULT_LOCALE];
  return bundle[code] || originalMessage;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const traceId = (request?.traceId as string | undefined) ?? 'no-trace';
    const acceptLanguage = request?.headers?.['accept-language'] as string | undefined;

    let status: number;
    let body: ErrorBody;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      const isObjectResp = typeof resp === 'object' && resp !== null;
      const code = (isObjectResp && (resp as { code?: string }).code) || `E-HTTP-${status}`;
      // M-7: ValidationPipe 多字段校验失败时 message 是 string[]，join('; ') 避免前端 alert 数组
      const rawMessage = isObjectResp ? (resp as { message?: unknown }).message : undefined;
      const originalMessage = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : typeof rawMessage === 'string'
          ? rawMessage
          : typeof resp === 'string'
            ? resp
            : exception.message;
      const details = isObjectResp ? (resp as { details?: unknown }).details : undefined;

      const message = localizeErrorMessage(code, originalMessage ?? 'Request failed', acceptLanguage);

      body = {
        success: false,
        error: {
          code,
          message,
          traceId,
          i18nKey: `errors.${code}`,
          ...(details !== undefined && { details }),
        },
      };
    } else {
      // 未捕获异常 → 500
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      const err = exception as { message?: string; stack?: string };
      logger.error({
        msg: 'unhandled_exception',
        traceId,
        error: err?.message ?? String(exception),
        stack: err?.stack,
      });

      body = {
        success: false,
        error: {
          code: 'E-COMMON-002',
          message: localizeErrorMessage('E-COMMON-002', 'Internal server error', acceptLanguage),
          traceId,
          i18nKey: 'errors.E-COMMON-002',
        },
      };
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}
