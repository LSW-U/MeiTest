/**
 * Fetch wrapper — 自动注入 X-Perspective + Accept-Language header
 *
 * 决策依据：CLAUDE.md §视角切换
 *   - 前端 fetch/axios interceptor 自动注入 X-Perspective header + Accept-Language
 *   - 后端 AuditInterceptor 读 header 写 AuditLog
 *
 * 用法：
 *   import { apiFetch } from '@/lib/fetch';
 *   const res = await apiFetch('/api/v1/admin/platform/dashboard/summary');
 *
 * 自动从 zustand store 取 perspective、从 cookie 取 locale（与 next-intl 一致）。
 */
'use client';

import { usePerspectiveStore } from '@/stores/perspective';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/config';

/** 从 cookie 取当前 locale（next-intl request.ts 写入） */
function readLocaleCookie(): SupportedLocale {
  if (typeof document === 'undefined') return DEFAULT_LOCALE;
  const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/);
  const value = match?.[1];
  return value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
    ? (value as SupportedLocale)
    : DEFAULT_LOCALE;
}

/**
 * 业务 fetch — 自动注入 X-Perspective + Accept-Language + 凭证
 *
 * MVP 阶段：JWT 存 localStorage（mock-login 写入），后续切换到 httpOnly cookie。
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const perspective = usePerspectiveStore.getState().perspective;
  const locale = readLocaleCookie();
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('admin_token') : null;

  const headers = new Headers(init.headers);
  headers.set('Accept-Language', locale);
  headers.set('X-Perspective', perspective);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return fetch(input, { ...init, headers, credentials: 'include' });
}

/** JSON 简化：apiFetch + res.json() + 业务错误码 throw */
export async function apiJson<T = unknown>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await apiFetch(input, init);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? `E-HTTP-${res.status}`, err?.message ?? res.statusText, data);
  }
  return data as T;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
