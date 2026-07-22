/**
 * CSRF 双重提交 Middleware（约束 6：admin-web httpOnly cookie 的配套 CSRF 防护）
 *
 * 原理：登录/刷新时后端 set 非 httpOnly 的 admin_csrf cookie（见 cookie-helper），
 *      前端 JS 读后放入 X-CSRF-Token header。本 middleware 校验 header === cookie。
 *      攻击者跨域读不到 cookie（同源策略），无法伪造匹配的 header → CSRF 被防。
 *
 * 适用范围（窄校验，不影响移动端）：
 * - 仅当请求带 admin_access_token cookie（admin_web）才校验；
 *   移动端走 Bearer 不带 cookie → 自动跳过（移动端无 CSRF 风险）
 * - GET / HEAD / OPTIONS 跳过（不改状态）
 * - 登录端点登录前无 cookie → hasAdminCookie=false 自动跳过
 *
 * 失败：403 E-AUTH-008。
 */
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/cookie-helper';

/** 不改状态的安全方法（无需 CSRF 校验） */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** admin-web access token cookie 名（与 cookie-helper ACCESS_COOKIE 一致，此处窄校验用） */
const ADMIN_ACCESS_COOKIE = 'admin_access_token';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    void res;
    // 无 admin cookie → 移动端 Bearer 或登录前请求，无 CSRF 风险，放行
    const hasAdminCookie = Boolean(req.cookies?.[ADMIN_ACCESS_COOKIE]);
    if (!hasAdminCookie) return next();

    // 安全方法不改状态，放行
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

    // 双重提交校验：header 与 cookie 必须都存在且相等
    const cookieToken = req.cookies?.[CSRF_COOKIE] ?? null;
    const headerToken = (req.headers[CSRF_HEADER] as string | undefined) ?? null;
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException({
        code: 'E-AUTH-008',
        message: 'CSRF token missing or invalid',
      });
    }
    next();
  }
}
