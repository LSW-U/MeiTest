'use client';

/**
 * Logout 按钮（task #132，cookie 模式配套）
 *
 * - 调 POST /api/v1/common/auth/logout（apiFetch 自动 credentials:include + X-CSRF-Token）
 * - 后端 clearAuthCookies（清 access/refresh/csrf cookie）+ revokeFamily
 * - 前端清 admin_session 标志 + 跳 /login
 * - 即使后端 logout 失败（refresh 已过期等），前端仍强制清 session 跳转（保证登出）
 */
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiFetch, setAuthenticated } from '@/lib/api';

export function LogoutButton() {
  const t = useTranslations('auth');
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    try {
      // mutate 请求 apiFetch 自动带 X-CSRF-Token（从 admin_csrf cookie 读）+ httpOnly cookie
      await apiFetch('/common/auth/logout', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    } catch {
      // 后端 logout 失败不阻塞前端登出（cookie 可能已被后端 clear，或 refresh 失效）
    } finally {
      setAuthenticated(false);
      window.location.href = '/login';
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      aria-label={t('logout.title')}
      title={t('logout.title')}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}
