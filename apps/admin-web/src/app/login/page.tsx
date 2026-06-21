'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { components } from '@meimart/shared-types';

type LoginRequest = components['schemas']['LoginRequest'];

export default function LoginPage() {
  const t = useTranslations('auth');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const body: LoginRequest = { identifier, password };
    // TODO: D4-T6 接入真实 /api/v1/common/auth/login-password
    console.log('login payload:', body);
    setTimeout(() => {
      setSubmitting(false);
      setError(t('login.devsStubNoBackend'));
    }, 300);
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
            type="text"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={t('login.identifierPlaceholder')}
            required
            autoComplete="username"
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
