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
import { normalizePhoneE164 } from '@meimart/api-contract';

/**
 * e2e 频控豁免（批A2-3 审查 P2-1 方案 a，2026-09-24）
 *
 * E2E_RATELIMIT_BYPASS=true 时跳过 sms:ip / sms:phone 维度限流——e2e 套件打真 HTTP
 * 会把本机 IP 桶（sms:ip:*:1h/24h，limit 20）打满，一小时内复跑全量 vitest 必 429
 * （自毒化）。仅 sms 维度豁免（e2e 唯一会打满的频控面），其余维度（login/register/
 * verify/feedback 等）照常生效，守卫不整体失效。
 *
 * ⚠️ 仅测试语义：E2E_RATELIMIT_BYPASS 不得在生产 env / GitHub Secret 配置——
 * 它会让真实 SMS 发码端点失去 IP 维防刷防线（phone/deviceId 维在 service 层不受影响，
 * 但 IP 维是边缘第一道）。生产部署清单不应出现该变量（.env.example 不提供此键）。
 */
const E2E_RATELIMIT_BYPASS_KEYS = ['sms:ip:', 'sms:phone:'];

/** e2e 豁免开关（env 每次现读，测试切换无需重置缓存） */
function isE2eRateLimitBypass(): boolean {
  return process.env.E2E_RATELIMIT_BYPASS === 'true';
}

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
    const bypass = isE2eRateLimitBypass();
    for (const options of optionsList) {
      // e2e 豁免（P2-1）：bypass 开 + sms 维度 → 跳过该段（不查 Redis 不烧桶）
      if (bypass && E2E_RATELIMIT_BYPASS_KEYS.some((p) => options.key.startsWith(p))) {
        continue;
      }
      const resolvedKey = this.resolveKey(options.key, request, ip);
      const result = await rateLimit(resolvedKey, options.limit, options.window);
      if (!result.allowed) {
        if (!blocked || result.retryAfter > blocked.retryAfter) {
          blocked = { retryAfter: result.retryAfter, key: resolvedKey };
        }
        logger.warn({
          msg: 'RATE_LIMIT_EXCEEDED',
          reason: 'rate_limited', // R17 拒发计数分桶（与 otp/sms.strategy 的 not_configured/provider_error 同族）
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
   * ${user.xxx}（P17 审查 P1 修复，2026-08-17）：JWT 解析后的 request.user 字段（如 ${user.sub}）。
   *   @Public 端点 request.user 为 undefined -> 'anonymous' 兜底（用户维度限流只该用在登录态端点）。
   *
   * 批A R9（2026-09-15）：phone 字段先归一化再 hash——guard 全局第 4 道在
   * ZodValidationPipe 之前跑，读 raw body，必须在这里归一化（方案 a，预研笔记④），
   * 否则 +670 7xx xxxx / +6707xxxxxxx / 00670... 同号异形各自成桶绕过限流。
   * 归一化实现与契约 PhoneE164 schema 共用 normalizePhoneE164（api-contract/common.ts）。
   */
  private resolveKey(template: string, request: any, ip: string): string {
    return template
      .replace(/\$\{ip\}/g, ip)
      .replace(/\$\{body\.(\w+)\}/g, (_, field: string) => {
        let val: unknown = request.body?.[field];
        if (!val) return 'unknown';
        // R9：手机号字段统一归一化形态进 hash（与 schema 存储形态一致）
        if (field === 'phone' || field === 'newPhone') {
          const normalized = normalizePhoneE164(val);
          if (!normalized) return 'unknown'; // 非法格式（schema 会 400），限流仍记账不放过
          val = normalized;
        }
        return createHash('sha256').update(String(val)).digest('hex').slice(0, 16);
      })
      .replace(/\$\{query\.(\w+)\}/g, (_, field: string) => {
        const val = request.query?.[field];
        return val ?? 'unknown';
      })
      .replace(/\$\{param\.(\w+)\}/g, (_, field: string) => {
        const val = request.params?.[field];
        return val ?? 'unknown';
      })
      .replace(/\$\{user\.(\w+)\}/g, (_, field: string) => {
        // P17 审查 P1：用户维度限流 key（change-password/change-phone 等登录态端点）
        const val = request.user?.[field];
        return val ?? 'anonymous';
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
