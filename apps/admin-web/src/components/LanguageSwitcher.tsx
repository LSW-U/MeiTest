'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n/config';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** 语言码 → 展示名（dropdown 列表用全名，trigger 只显示 Globe 图标，宽度恒定） */
const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  zh: '中文',
  id: 'Bahasa Indonesia',
  pt: 'Português',
  tet: 'Tetum',
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const t = useTranslations('common');

  /** 切换语言：写 cookie + router.refresh，dropdown 自动收起 */
  function onChange(next: string) {
    const nextLocale = next as SupportedLocale;
    if (nextLocale === locale) return;
    startTransition(() => {
      document.cookie = `locale=${nextLocale}; path=/; max-age=${60 * 60 * 24 * 365}`;
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={isPending}
          aria-label={t('changeLanguage')}
          className="h-9 w-9"
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={locale} onValueChange={onChange}>
          {SUPPORTED_LOCALES.map((l) => (
            <DropdownMenuRadioItem key={l} value={l}>
              {LOCALE_LABELS[l]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
