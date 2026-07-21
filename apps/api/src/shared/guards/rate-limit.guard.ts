/**
 * RateLimitGuard（W7-ext-H 修复 v1.2）
 *
 * 全局 APP_GUARD，检查 @RateLimit 装饰器。无装饰器则跳过。
 * 复用 rate-limit.ts 的 Redis 滑动窗口（不引 throttler 内存存储）。
 *
 * 超限响应 429 + Retry-After header + body { code, message, retryAfter }
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../decorators/rate-limit.decorator';
import { rateLimit } from '../cache/rate-limit';
import { logger } from '../logger/logger';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const optionsList = this.reflector.getAllAndOverride<RateLimitOptions[] | undefined>(
      RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!optionsList || optionsList.length === 0) {
      return true; // 无 @RateLimit 装饰器，跳过
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const ip = this.getClientIp(request);

    // 多维度限流：任一超限即拒，取最严格（retryAfter 最大）的返回
    let blocked: { retryAfter: number; key: string } | null = null;
    for (const options of optionsList) {
      const resolvedKey = this.resolveKey(options.key, request, ip);
      const result = await rateLimit(resolvedKey, options.limit, options.window);
      if (!result.allowed) {
        if (!blocked || result.retryAfter > blocked.retryAfter) {
          blocked = { retryAfter: result.retryAfter, key: resolvedKey };
        }
        logger.warn({
          msg: 'RATE_LIMIT_EXCEEDED',
          key: resolvedKey, // 已 hash，不含明文手机号
          current: result.current,
          limit: result.limit,
          retryAfter: result.retryAfter,
          ip,
        });
      }
    }

    if (blocked) {
      // 设 Retry-After header（RFC 6585 §4）
      response.setHeader('Retry-After', String(blocked.retryAfter));
      throw new HttpException(
        {
          code: 'E-RATELIMIT-001',
          message: 'Too many requests, please retry later',
          details: { retryAfter: blocked.retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /**
   * 解析 key 模板
   *
   * 安全：${body.xxx} 值用 SHA256 hash（截断 16），Redis key 不含明文手机号/邮箱。
   * ${ip} 保留明文（IP 非手机号，限流调试需要）。
   */
  private resolveKey(template: string, request: any, ip: string): string {
    return template
      .replace(/\$\{ip\}/g, ip)
      .replace(/\$\{body\.(\w+)\}/g, (_, field: string) => {
        const val = request.body?.[field];
        if (!val) return 'unknown';
        return createHash('sha256').update(String(val)).digest('hex').slice(0, 16);
      })
      .replace(/\$\{query\.(\w+)\}/g, (_, field: string) => {
        const val = request.query?.[field];
        return val ?? 'unknown';
      })
      .replace(/\$\{param\.(\w+)\}/g, (_, field: string) => {
        const val = request.params?.[field];
        return val ?? 'unknown';
      });
  }

  /** 获取客户端 IP（trust proxy 生效后取 X-Forwarded-For 首个） */
  private getClientIp(request: any): string {
    return (
      request.ip ||
      request.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      request.connection?.remoteAddress ||
      'unknown'
    );
  }
}
