'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/config';

const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '中文',
  id: 'Bahasa Indonesia',
  pt: 'Português',
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations('common');

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as SupportedLocale;
    startTransition(() => {
      document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}`;
      router.refresh();
    });
  }

  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14,
      }}
    >
      <span aria-hidden>🌍</span>
      <select
        value={locale}
        onChange={onChange}
        disabled={isPending}
        aria-label={t('changeLanguage')}
        style={{ padding: '4px 8px' }}
      >
        {SUPPORTED_LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l]}
          </option>
        ))}
      </select>
    </label>
  );
}
