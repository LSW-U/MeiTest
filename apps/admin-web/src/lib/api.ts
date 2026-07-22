/**
 * API fetch wrapper（admin-web）
 *
 * 约束 6（2026-07-23）：admin-web 切 httpOnly cookie 双通道鉴权
 * - token 不再走 localStorage（XSS 可读）→ httpOnly cookie（credentials: include 自动带，JS 不可读）
 * - mutate 请求带 X-CSRF-Token header（从非 httpOnly admin_csrf cookie 读，双重提交防 CSRF）
 * - localStorage 仅留非敏感 admin_session 标志（前端路由判断用，不参与鉴权）
 * - 移动端不受影响（继续 Bearer + SecureStore，不走本封装）
 *
 * 其他：
 * - 自动注入 X-Perspective header（与 PerspectiveContext 同源）
 * - 自动注入 Accept-Language header（next-intl）
 * - 401 自动清 session 跳 /login
 * - 错误统一包装为 ApiError（带 code / message / status）
 */
import type { Locale } from '@meimart/shared-locales';

/** 5 视角（与 zustand perspective state 对应） */
export type Perspective = 'platform' | 'merchant' | 'warehouse' | 'support' | 'rider-mgmt';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

/** 非敏感登录标志 key（仅前端路由判断，真实鉴权靠 httpOnly cookie） */
const SESSION_KEY = 'admin_session';
const PERSPECTIVE_KEY = 'admin_perspective';
/** 改状态的 HTTP 方法（需带 X-CSRF-Token） */
const MUTATE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export interface FetchOptions extends RequestInit {
  /** 不带 cookie/CSRF（如登录前调用） */
  noAuth?: boolean;
}

/**
 * 是否已登录（前端路由判断用）
 *
 * 仅检查非敏感标志；真实鉴权由后端 httpOnly cookie 校验。
 * 标志可能滞后（cookie 失效但标志还在）→ 下个请求 401 → 自动清标志跳 /login。
 */
export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SESSION_KEY) === '1';
}

/** 设置/清除登录标志（登录成功 set，401/logout clear） */
export function setAuthenticated(authed: boolean): void {
  if (typeof window === 'undefined') return;
  if (authed) {
    window.localStorage.setItem(SESSION_KEY, '1');
  } else {
    window.localStorage.removeItem(SESSION_KEY);
  }
}

export function getPerspective(): Perspective | null {
  if (typeof window === 'undefined') return null;
  return (window.localStorage.getItem(PERSPECTIVE_KEY) as Perspective | null) ?? null;
}

export function getLocale(): Locale {
  if (typeof document === 'undefined') return 'en';
  return (document.documentElement.lang as Locale) || 'en';
}

/** 从非 httpOnly cookie 读 CSRF token（双重提交：读后放 X-CSRF-Token header） */
function getCsrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)admin_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const perspective = getPerspective();
  const lang = getLocale();

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept-Language', lang);
  if (perspective) headers.set('X-Perspective', perspective);
  // 约束 6 CSRF：mutate 请求带 X-CSRF-Token（从 admin_csrf cookie 读）
  const method = (options.method ?? 'GET').toUpperCase();
  if (!options.noAuth && MUTATE_METHODS.has(method)) {
    const csrf = getCsrfTokenFromCookie();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include', // 约束 6：带 httpOnly cookie（access + refresh + csrf）
  });

  if (res.status === 401 && typeof window !== 'undefined' && !options.noAuth) {
    setAuthenticated(false);
    window.location.href = '/login';
    throw new ApiError('E-AUTH-001', 'Unauthorized', 401);
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new ApiError(
      errorBody?.error?.code ?? `E-HTTP-${res.status}`,
      errorBody?.error?.message ?? res.statusText,
      res.status,
    );
  }

  // 204 No Content 或空 body 不解析 JSON（避免 "Unexpected end of JSON input"）
  if (res.status === 204) {
    return null as T;
  }
  const text = await res.text();
  if (!text) {
    return null as T;
  }
  return JSON.parse(text) as T;
}

/** 上传文件（multipart/form-data，不带默认 Content-Type，让浏览器自动设 boundary） */
export async function apiUploadFile<T = unknown>(
  path: string,
  file: File,
  fieldName = 'file',
): Promise<T> {
  const perspective = getPerspective();
  const lang = getLocale();

  const headers = new Headers();
  headers.set('Accept-Language', lang);
  if (perspective) headers.set('X-Perspective', perspective);
  // 上传是 POST mutate，带 CSRF
  const csrf = getCsrfTokenFromCookie();
  if (csrf) headers.set('X-CSRF-Token', csrf);

  const formData = new FormData();
  formData.append(fieldName, file);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
    credentials: 'include', // 约束 6：带 httpOnly cookie
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    setAuthenticated(false);
    window.location.href = '/login';
    throw new ApiError('E-AUTH-001', 'Unauthorized', 401);
  }

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new ApiError(
      errorBody?.error?.code ?? `E-HTTP-${res.status}`,
      errorBody?.error?.message ?? res.statusText,
      res.status,
    );
  }

  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (null as T);
}

/** 标准响应包装：{ success: true, data } */
export type ApiSuccess<T> = { success: true; data: T };
