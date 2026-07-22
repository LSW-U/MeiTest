/**
 * Cookie Helper（约束 6：admin-web httpOnly cookie 双通道鉴权）
 *
 * Web（admin-web）：httpOnly cookie（XSS 不可读）
 * 移动端（client/rider App）：Bearer header + SecureStore（不变）
 *
 * Cookie 属性：
 * - httpOnly: true（JS 不可读，防 XSS 窃取）
 * - secure: prod true（仅 HTTPS）/ dev false（localhost）
 * - sameSite: 'lax'（防 CSRF，允许顶层导航带 cookie）
 * - path: '/api/v1'（限制 cookie 范围）
 */
import type { Response } from 'express';

const COOKIE_PATH = '/api/v1';
const IS_PROD = process.env.NODE_ENV === 'production';

const ACCESS_COOKIE = 'admin_access_token';
const REFRESH_COOKIE = 'admin_refresh_token';

/** access token cookie 选项 */
function accessCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** refresh token cookie 选项 */
function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/**
 * 设置 auth cookies（登录 / 刷新时调）
 *
 * @param res Express Response
 * @param accessToken 短 TTL（按 deviceType，admin_web 2h）
 * @param refreshToken 长 TTL（60d）
 * @param accessExpiresAt access 过期时间戳（秒）
 * @param refreshExpiresAt refresh 过期时间戳（秒）
 */
export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  accessExpiresAt: number,
  refreshExpiresAt: number,
): void {
  const now = Math.floor(Date.now() / 1000);
  const accessMaxAge = Math.max(0, (accessExpiresAt - now) * 1000);
  const refreshMaxAge = Math.max(0, (refreshExpiresAt - now) * 1000);

  res.cookie(ACCESS_COOKIE, accessToken, accessCookieOptions(accessMaxAge));
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshMaxAge));
}

/**
 * 清除 auth cookies（logout 时调）
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
}

/**
 * 从 cookie 读 refresh token（refresh / logout 端点用）
 *
 * 移动端仍用 body.refreshToken（Bearer + SecureStore）。
 * admin-web 用 cookie。双通道：优先 body，fallback cookie。
 */
export function getRefreshTokenFromCookie(req: { cookies?: Record<string, string> }): string | null {
  return req.cookies?.[REFRESH_COOKIE] ?? null;
}

/**
 * 从 cookie 读 access token（JwtStrategy 用）
 *
 * 移动端用 Authorization header。admin-web 用 cookie。
 * 双通道：优先 header，fallback cookie。
 */
export function getAccessTokenFromCookie(req: { cookies?: Record<string, string> }): string | null {
  return req.cookies?.[ACCESS_COOKIE] ?? null;
}
