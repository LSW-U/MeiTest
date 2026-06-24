/**
 * API fetch wrapper（admin-web）
 *
 * - 自动注入 Authorization: Bearer <token>（从 localStorage 读）
 * - 自动注入 X-Perspective header（从 PerspectiveContext 读，server 端 fallback null）
 * - 自动注入 Accept-Language header（从 next-intl 读）
 * - 错误统一包装为 { success: false, error: { code, message } }
 *
 * W2-W 流程 2026-06-24：仅 admin-web 用，client/rider-app 在 MeiMart1.0 repo
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export interface FetchOptions extends RequestInit {
  /** 不带 Authorization（如登录前调用） */
  noAuth?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem('admin_token') : null;
  const perspective =
    typeof window !== 'undefined' ? window.localStorage.getItem('admin_perspective') : null;
  const lang =
    typeof document !== 'undefined' ? document.documentElement.lang || 'en' : 'en';

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

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    throw new ApiError(
      errorBody?.error?.code ?? `E-HTTP-${res.status}`,
      errorBody?.error?.message ?? res.statusText,
      res.status,
    );
  }

  return res.json() as Promise<T>;
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

/** 标准响应包装：{ success: true, data } */
export type ApiSuccess<T> = { success: true; data: T };
