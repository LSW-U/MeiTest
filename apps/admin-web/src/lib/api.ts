/**
 * API fetch wrapper（admin-web）
 *
 * - 自动注入 Authorization: Bearer <token>（从 localStorage 读）
 * - 自动注入 X-Perspective header（与 PerspectiveContext 同源）
 * - 自动注入 Accept-Language header（next-intl）
 * - 401 自动清 token 跳 /login
 * - 错误统一包装为 ApiError（带 code / message / status）
 *
 * 兼容 W2-W 的 perspective.tsx（key: admin_perspective / admin_token）
 */

import type { Locale } from '@meimart/shared-locales';

/** 5 视角（与 zustand perspective state 对应） */
export type Perspective = 'platform' | 'merchant' | 'warehouse' | 'support' | 'rider-mgmt';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

const TOKEN_KEY = 'admin_token';
const PERSPECTIVE_KEY = 'admin_perspective';

export interface FetchOptions extends RequestInit {
  /** 不带 Authorization（如登录前调用） */
  noAuth?: boolean;
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
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
  const token = getAccessToken();
  const perspective = getPerspective();
  const lang = getLocale();

  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Accept-Language', lang);
  if (perspective) headers.set('X-Perspective', perspective);
  if (token && !options.noAuth) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401 && typeof window !== 'undefined' && !options.noAuth) {
    setAccessToken(null);
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

/** 标准响应包装：{ success: true, data } */
export type ApiSuccess<T> = { success: true; data: T };
