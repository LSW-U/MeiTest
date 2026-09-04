'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@meimart/shared-types';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

type LoginPasswordRequest = components['schemas']['LoginPasswordRequest'];

/**
 * LoginPage — admin-web 账号密码登录页
 *
 * 约束 6：token 走 httpOnly cookie（credentials: 'include' 收 set-cookie），
 * 前端 localStorage 只记非敏感登录标志（admin_session / admin_perspective）。
 */
export default function LoginPage() {
  const t = useTranslations('auth');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body: LoginPasswordRequest = { phone, password };
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000/api/v1';

    try {
      const resp = await fetch(`${apiBase}/common/auth/login-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include', // 约束 6：收 httpOnly set-cookie（access + refresh + csrf）
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        setError(data?.error?.message ?? `Login failed (HTTP ${resp.status})`);
        return;
      }
      // 约束 6：token 走 httpOnly cookie（浏览器自动存），前端只记非敏感登录标志
      window.localStorage.setItem('admin_session', '1');
      window.localStorage.setItem('admin_perspective', 'platform');
      // 同时同步 zustand store（与 PerspectiveSwitcher/Sidebar 一致）
      const { usePerspectiveStore } = await import('@/stores/perspective');
      usePerspectiveStore.getState().setPerspective('platform');
      // 跳 dashboard 内容页（/ 是 server component 永远 redirect /login，跳 /dashboard）
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12 dark:bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">{t('login.title')}</CardTitle>
          <CardDescription>{t('login.identifier')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="login-phone">{t('login.identifier')}</Label>
              <Input
                id="login-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+670999999999"
                required
                autoComplete="tel"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="login-password">{t('login.password')}</Label>
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('login.passwordPlaceholder')}
                required
                autoComplete="current-password"
                minLength={8}
              />
            </div>

            {error && (
              <Alert className="border-destructive/50 bg-destructive/5 text-destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting}>
              {submitting ? t('login.submitting') : t('login.submit')}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-xs text-muted-foreground">{t('login.seedAccountHint')}</p>
        </CardFooter>
      </Card>
    </div>
  );
}
