'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/api';

/**
 * 根路由 / — client component
 *
 * 约束 6：登录态看非敏感 admin_session 标志（真实鉴权靠 httpOnly cookie）。
 * - 已登录：跳 /dashboard（KPI 面板）
 * - 未登录：跳 /login
 */
export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(isAuthenticated() ? '/dashboard' : '/login');
  }, [router]);
  return null;
}
