/**
 * 全局异常过滤器：统一错误响应格式
 *
 * 决策依据：D4-T1 acceptance — 异常返回统一结构 { code, message, traceId, i18nKey }
 *
 * 响应格式：
 *   {
 *     success: false,
 *     error: {
 *       code: "E-COMMON-001",         // 错误码（E-MODULE-NUMBER 格式）
 *       message: "面向用户的友好提示",  // 已按 Accept-Language 本地化（D5-T2 完善）
 *       traceId: "uuid",                // 贯穿 Sentry / 日志
 *       i18nKey?: "errors.E-COMMON-001" // 前端查 i18n 翻译
 *     }
 *   }
 */
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

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

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest();
    const traceId = (request?.traceId as string | undefined) ?? 'no-trace';

    let status: number;
    let body: ErrorBody;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      const isObjectResp = typeof resp === 'object' && resp !== null;
      const code = (isObjectResp && (resp as { code?: string }).code) || `E-HTTP-${status}`;
      const message =
        (isObjectResp && (resp as { message?: string }).message) ||
        (typeof resp === 'string' ? resp : exception.message);
      const details = isObjectResp ? (resp as { details?: unknown }).details : undefined;

      body = {
        success: false,
        error: {
          code,
          message: message ?? 'Request failed',
          traceId,
          i18nKey: `errors.${code}`,
          ...(details !== undefined && { details }),
        },
      };
    } else {
      // 未捕获异常 → 500
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      const err = exception as { message?: string; stack?: string };
      this.logger.error({
        msg: 'unhandled_exception',
        traceId,
        error: err?.message ?? String(exception),
        stack: err?.stack,
      });

      body = {
        success: false,
        error: {
          code: 'E-COMMON-INTERNAL',
          message: 'Internal server error',
          traceId,
          i18nKey: 'errors.E-COMMON-INTERNAL',
        },
      };
    }

    httpAdapter.reply(ctx.getResponse(), body, status);
  }
}
