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
import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { DeviceType } from '@meimart/api-contract';

const COOKIE_PATH = '/api/v1';

/** 是否生产环境（函数形式：env 可被测试动态切换，避免模块常量在加载时冻结导致 prod 分支不可测） */
function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

const ACCESS_COOKIE = 'admin_access_token';
const REFRESH_COOKIE = 'admin_refresh_token';
/** CSRF 双重提交 token cookie 名（非 httpOnly：前端 JS 需读取后放 X-CSRF-Token header） */
export const CSRF_COOKIE = 'admin_csrf';
/** CSRF header 名（前端 apiFetch 注入 + 后端 CsrfMiddleware 校验） */
export const CSRF_HEADER = 'x-csrf-token';

/** access token + refresh token 凑对（登录/刷新端点的返回子集） */
export interface TokenPairForCookie {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

/** access token cookie 选项 */
function accessCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** refresh token cookie 选项 */
function refreshCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: COOKIE_PATH,
    maxAge: maxAgeMs,
  };
}

/** CSRF token cookie 选项（httpOnly: false — 前端 JS 必须能读取以放入 X-CSRF-Token header） */
function csrfCookieOptions(maxAgeMs: number) {
  return {
    httpOnly: false,
    secure: isProd(),
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
 * 按 deviceType 条件设置 auth cookies（登录 / 刷新端点统一入口）
 *
 * - `admin_web`：set cookie（Web 双通道用）
 * - `client_app` / `rider_app`：**不 set**（移动端走 Bearer + SecureStore，
 *   避免给 native 响应塞无用 Set-Cookie，也防 WebView 场景误存 customer token）
 *
 * 逻辑收敛在此处：所有认证端点统一调本函数，避免散落 5+ 处 `if (deviceType === 'admin_web')` 漏判。
 */
export function setAuthCookiesForDevice(
  res: Response,
  deviceType: DeviceType,
  tokens: TokenPairForCookie,
): void {
  if (deviceType !== 'admin_web') return;
  setAuthCookies(
    res,
    tokens.accessToken,
    tokens.refreshToken,
    tokens.accessExpiresAt,
    tokens.refreshExpiresAt,
  );
  // 约束 6 CSRF 双重提交：登录/刷新时生成随机 token，set 非 httpOnly cookie
  // 前端 JS 读后放 X-CSRF-Token header，后端 CsrfMiddleware 校验 header === cookie（攻击者跨域读不到 cookie，无法伪造匹配的 header）
  const now = Math.floor(Date.now() / 1000);
  const accessMaxAge = Math.max(0, (tokens.accessExpiresAt - now) * 1000);
  const csrfToken = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions(accessMaxAge));
}

/**
 * 清除 auth cookies（logout 时调）
 *
 * 幂等：对不存在的 cookie 无副作用。移动端 logout 调到也安全（响应多个空 Set-Cookie 头无害）。
 * 不按 deviceType 判断 —— logout 时无法可靠拿到 deviceType（refreshToken 可能已失效），
 * 无条件 clear 最安全。
 */
export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { path: COOKIE_PATH });
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
