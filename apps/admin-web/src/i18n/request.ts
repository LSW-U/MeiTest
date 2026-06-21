import { getRequestConfig } from 'next-intl/server';
import type { AbstractIntlMessages } from 'next-intl';
import { cookies } from 'next/headers';
import {
  messages,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  type Locale,
} from '@meimart/shared-locales';
import { SUPPORTED_LOCALES as WEB_LOCALES, type SupportedLocale } from './config';

export { WEB_LOCALES as SUPPORTED_LOCALES, DEFAULT_LOCALE };
export type { SupportedLocale };

export default getRequestConfig(async () => {
  // 从 cookie 读 locale（客户端切换时写入），fallback en
  const cookieStore = await cookies();
  const raw = cookieStore.get('locale')?.value;
  const locale: Locale =
    typeof raw === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(raw)
      ? (raw as Locale)
      : DEFAULT_LOCALE;

  return {
    locale,
    // 直接消费 shared-locales 的 messages bundle（9 模块 namespace）
    messages: messages[locale] as unknown as AbstractIntlMessages,
  };
});
