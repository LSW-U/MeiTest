/**
 * @RateLimit 装饰器（W7-ext-H 修复 v1.2）
 *
 * 标记端点需要 Redis 滑动窗口限流。配合 RateLimitGuard（全局 APP_GUARD）。
 * 支持多维度（传多个 options，任一超限即拒，返回最严格的 retryAfter）。
 *
 * key 模板支持：
 *   - ${ip}            -> 请求 IP（trust proxy 生效后的真实 IP）
 *   - ${body.field}    -> 请求 body 字段（如 ${body.phone}）
 *   - ${query.field}   -> 请求 query 字段
 *   - ${param.field}    -> 路由参数
 *
 * 用法：
 *   @RateLimit({ key: 'login:ip:${ip}', limit: 10, window: 60 })
 *   @RateLimit(
 *     { key: 'sms:ip:${ip}', limit: 20, window: 3600 },
 *     { key: 'sms:phone:${body.phone}', limit: 1, window: 60 },
 *   )
 */
import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  /** 限流 key 模板（支持 ${ip} ${body.xxx} ${query.xxx} ${param.xxx}） */
  key: string;
  /** 窗口内最大次数 */
  limit: number;
  /** 窗口大小（秒） */
  window: number;
}

export const RateLimit = (...options: RateLimitOptions[]) =>
  SetMetadata(RATE_LIMIT_KEY, options);

