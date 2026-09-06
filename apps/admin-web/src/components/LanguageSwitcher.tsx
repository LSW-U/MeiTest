'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import type { SupportedLocale } from '@/i18n/config';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * 语言注册表（Q2/Q5：注册表驱动，加语言 = 注入一项并置 enabled=true，不改业务代码）
 *
 * admin 仅开放 zh（默认）/ en；tet/pt/id 资源保留在 shared-locales，但 UI 不渲染
 * （用户看不到未译内容，Q9）。nativeLabel 用语言自称，不随当前语言翻译。
 */
interface LanguageOption {
  code: SupportedLocale;
  nativeLabel: string;
  enabled: boolean;
}

const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'zh', nativeLabel: '中文', enabled: true },
  { code: 'en', nativeLabel: 'English', enabled: true },
  { code: 'pt', nativeLabel: 'Português', enabled: false },
  { code: 'id', nativeLabel: 'Bahasa Indonesia', enabled: false },
  { code: 'tet', nativeLabel: 'Tetum', enabled: false },
];

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
          {LANGUAGE_OPTIONS.filter((o) => o.enabled).map((o) => (
            <DropdownMenuRadioItem key={o.code} value={o.code}>
              {o.nativeLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
