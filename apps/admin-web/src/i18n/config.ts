/**
 * i18n 共享常量（client/server 都可 import）
 *
 * 注意：不要在此文件 import 'next/headers' 或 'next-intl/server'，
 * 否则 client component 不能用。
 */
export const SUPPORTED_LOCALES = ['en', 'zh', 'id', 'pt'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = 'en';
