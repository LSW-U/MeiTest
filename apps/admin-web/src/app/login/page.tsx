'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@meimart/shared-types';

type LoginPasswordRequest = components['schemas']['LoginPasswordRequest'];

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
      // 跳 dashboard 内容页（/ 是 server component 永远 redirect /login，跳 /products）
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        maxWidth: 400,
        margin: '60px auto',
        padding: 32,
        background: 'white',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}
    >
      <h1
        style={{
          marginTop: 0,
          marginBottom: 24,
          fontSize: 24,
          fontWeight: 600,
        }}
      >
        {t('login.title')}
      </h1>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
        <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
          <span>{t('login.identifier')}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+670999999999"
            required
            autoComplete="tel"
            style={{
              padding: '8px 12px',
              border: '1px solid #d5d5d5',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
          <span>{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.passwordPlaceholder')}
            required
            autoComplete="current-password"
            minLength={8}
            style={{
              padding: '8px 12px',
              border: '1px solid #d5d5d5',
              borderRadius: 4,
              fontSize: 14,
            }}
          />
        </label>

        {error && (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: '#fff4f4',
              border: '1px solid #ffb4b4',
              borderRadius: 4,
              color: '#a02020',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: '10px 16px',
            background: submitting ? '#9bb8e0' : '#1a5dc2',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            fontSize: 14,
            fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer',
          }}
        >
          {submitting ? t('login.submitting') : t('login.submit')}
        </button>
      </form>

      <p
        style={{
          marginTop: 24,
          fontSize: 12,
          color: '#888',
          textAlign: 'center',
        }}
      >
        {t('login.seedAccountHint')}
      </p>
    </div>
  );
}
