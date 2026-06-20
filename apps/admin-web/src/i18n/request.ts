import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type SupportedLocale } from './config';

export { SUPPORTED_LOCALES, DEFAULT_LOCALE };
export type { SupportedLocale };

export default getRequestConfig(async () => {
  // 从 cookie 读 locale（客户端切换时写入），fallback en
  const cookieStore = await cookies();
  const raw = cookieStore.get('locale')?.value;
  const locale: SupportedLocale =
    typeof raw === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(raw)
      ? (raw as SupportedLocale)
      : DEFAULT_LOCALE;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
