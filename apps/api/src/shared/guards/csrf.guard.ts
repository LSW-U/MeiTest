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

/**
 * CSRF 豁免路径（登录/注册/刷新等"建立会话前"端点）。
 *
 * 背景（2026-10-20 修复）：浏览器残留上次登录种下的 admin_access_token cookie 时，
 * 登录请求被误判为"已登录 admin_web 请求"要求 CSRF 配对 → 403 E-AUTH-011，无法重新登录。
 * 这些端点在会话建立之前，不存在可被 CSRF 劫持的受保护会话（业界标准豁免做法）。
 * 注意 refresh/logout 虽带会话语义，但走 refreshToken 凭证校验且依赖旧 cookie 可用，
 * 故一并豁免，避免"cookie 过期轮换窗口"内被 CSRF guard 卡死。
 */
const CSRF_EXEMPT_PATHS = new Set([
  '/api/v1/common/auth/login-password',
  '/api/v1/common/auth/login-sms',
  '/api/v1/common/auth/register',
  '/api/v1/common/auth/sms-code',
  '/api/v1/common/auth/password-reset',
  '/api/v1/common/auth/refresh',
  '/api/v1/common/auth/logout',
]);

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

    // 登录/注册/刷新等建立会话前端点 → 豁免（残留旧 cookie 不应阻断重新登录）
    if (CSRF_EXEMPT_PATHS.has(req.url?.split('?')[0] ?? '')) return true;

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
