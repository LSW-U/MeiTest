'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * 根路由 / — client component
 *
 * - 已登录（localStorage 有 admin_token）：跳 /dashboard（KPI 面板）
 * - 未登录：跳 /login
 */
export default function RootRedirect() {
  const router = useRouter();
  useEffect(() => {
    const token = window.localStorage.getItem('admin_token');
    router.replace(token ? '/dashboard' : '/login');
  }, [router]);
  return null;
}
