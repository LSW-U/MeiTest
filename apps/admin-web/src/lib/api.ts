/**
 * Admin Web fetch wrapper
 *
 * - 自动注入 Authorization Bearer token（从 localStorage 读 mock login 时存的 accessToken）
 * - 自动注入 Accept-Language + X-Perspective header（与契约一致）
 * - 401 时清 token 跳 /login
 *
 * MVP：client-side fetch；SSR 后置（W3 接入 server components 时再分 server/client wrapper）
 */
import type { Locale } from '@meimart/shared-locales';

/** 5 视角（与 zustand perspective state 对应） */
export type Perspective = 'platform' | 'merchant' | 'warehouse' | 'support' | 'rider-mgmt';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000/api/v1';
const TOKEN_KEY = 'meimart:accessToken';
const LOCALE_KEY = 'meimart:locale';
const PERSPECTIVE_KEY = 'meimart:perspective';

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

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(LOCALE_KEY);
  return (stored as Locale) ?? 'en';
}

export function getPerspective(): Perspective {
  if (typeof window === 'undefined') return 'platform';
  const stored = window.localStorage.getItem(PERSPECTIVE_KEY);
  return (stored as Perspective) ?? 'platform';
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: unknown;
  };
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();
  const locale = getLocale();
  const perspective = getPerspective();

  const headers = new Headers(init.headers);
  headers.set('Accept-Language', locale);
  headers.set('X-Perspective', perspective);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const resp = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (resp.status === 401 && typeof window !== 'undefined') {
    setAccessToken(null);
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = (await resp.json()) as T | ApiError;
  if (!resp.ok) {
    const err = (data as ApiError).error;
    throw new Error(`${err.code}: ${err.message}`);
  }
  return data as T;
}
