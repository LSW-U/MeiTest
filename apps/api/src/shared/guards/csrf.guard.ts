/**
 * CSRF Guard（约束 6：admin-web httpOnly cookie 配套 CSRF 防护）
 *
 * F3 重构（2026-07-23）：从 CsrfMiddleware 迁移为 Guard。
 * 理由：Guard 在控制器链内，抛出的 ForbiddenException 经全局 AllExceptionsFilter
 *      → 自动获得 traceId + 统一响应形状 { code, message, traceId, i18nKey }。
 *      原 middleware 在控制器链外，异常走 Nest 内置处理器，绕过 AllExceptionsFilter 导致缺 traceId。
 *
 * 原理：登录/刷新时后端 set 非 httpOnly admin_csrf cookie（见 cookie-helper），
 *      前端 JS 读后放 X-CSRF-Token header。本 Guard 校验 header === cookie。
 *      攻击者跨域读不到 cookie（SOP），无法伪造匹配 header → CSRF 被防。
 *
 * 适用范围（窄校验，不影响移动端）：
 * - 仅当请求带 admin_access_token cookie（admin_web）才校验；
 *   移动端 Bearer / 登录前请求无 admin cookie → 自动放行
 * - GET / HEAD / OPTIONS 跳过（不改状态）
 *
 * 失败：403 E-AUTH-011（经 AllExceptionsFilter，带 traceId）。
 */
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { CSRF_COOKIE, CSRF_HEADER } from '../auth/cookie-helper';

/** 不改状态的安全方法（无需 CSRF 校验） */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** admin-web access token cookie 名（与 cookie-helper ACCESS_COOKIE 一致，此处窄校验用） */
const ADMIN_ACCESS_COOKIE = 'admin_access_token';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    // 无 admin cookie → 移动端 Bearer 或登录前请求，无 CSRF 风险，放行
    const hasAdminCookie = Boolean(req.cookies?.[ADMIN_ACCESS_COOKIE]);
    if (!hasAdminCookie) return true;

    // 安全方法不改状态，放行
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;

    // 双重提交校验：header 与 cookie 必须都存在且相等
    const cookieToken = req.cookies?.[CSRF_COOKIE] ?? null;
    const headerToken = (req.headers[CSRF_HEADER] as string | undefined) ?? null;
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException({
        code: 'E-AUTH-011',
        message: 'CSRF token missing or invalid',
      });
    }
    return true;
  }
}
