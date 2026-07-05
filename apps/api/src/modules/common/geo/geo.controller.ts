/**
 * Geo Controller — 地址 geocoding（W7 P0-3 + W7-fix P1-3 rate limit）
 *
 * 1 个 endpoint：
 *   - GET /api/v1/common/geo/geocode?address=xxx  公开（无需登录，地址输入时调）
 *
 * 设计：
 *   - Public（用户在保存地址前可能未登录，例如注册流程中的地址输入）
 *   - deviceType 不限制（/common/* 前缀自动放行 DeviceTypeGuard）
 *   - 用 zod 校验 query（address 长度 2-500）
 *
 * Rate limit（W7-fix P1-3）：
 *   - Nominatim Usage Policy 要求 ≤ 1 req/s
 *   - 接口暴露公网可能被脚本滥用，导致 Nominatim 限频触发 fallback
 *   - 内存 rate limit：每 IP 1 req/s + 10 req/min
 *   - 多实例部署需切换 Redis store（@nestjs/throttler），当前 MVP 单实例够用
 */
import { Controller, Get, Query, Inject, HttpException, HttpStatus, Req } from '@nestjs/common';
import type { Request } from 'express';
import { GeocodeRequest } from '@meimart/api-contract';
import { GeoService } from './geo.service';
import { Public } from '../../../shared/decorators/public.decorator';
import { ZodValidationPipe } from '../../../shared/pipes/zod-validation.pipe';

/** 简易内存 rate limiter（每 IP） */
class RateLimiter {
  private readonly buckets = new Map<string, number[]>();
  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  /** 返回 true 表示允许，false 表示超限 */
  allow(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const arr = (this.buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (arr.length >= this.maxRequests) {
      this.buckets.set(key, arr);
      return false;
    }
    arr.push(now);
    this.buckets.set(key, arr);
    return true;
  }
}

/** 单实例：1 req/s + 10 req/min/IP */
const perSecondLimiter = new RateLimiter(1000, 1);
const perMinuteLimiter = new RateLimiter(60_000, 10);

/** 从 Express Request 拿客户端 IP（处理 nginx 反代 X-Forwarded-For） */
function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

@Controller('api/v1/common/geo')
export class GeoController {
  constructor(@Inject(GeoService) private readonly geo: GeoService) {}

  /** 地址 → 经纬度（公开，无需登录） */
  @Public()
  @Get('geocode')
  async geocode(
    @Query(new ZodValidationPipe(GeocodeRequest)) query: { address: string },
    @Req() req: Request,
  ) {
    const ip = getClientIp(req);

    if (!perSecondLimiter.allow(ip) || !perMinuteLimiter.allow(ip)) {
      throw new HttpException(
        {
          success: false,
          error: {
            code: 'E-COMMON-004',
            message: 'Too many requests, please slow down',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.geo.geocode(query.address);
    return { success: true, data: result };
  }
}
