/**
 * i18n 共享常量（client/server 都可 import）
 *
 * 注意：不要在此文件 import 'next/headers' 或 'next-intl/server'，
 * 否则 client component 不能用。
 */
export const SUPPORTED_LOCALES = ['en', 'zh', 'id', 'pt', 'tet'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
/** 默认语言（Q1：后台默认中文开箱即用；手动选择后经 locale cookie 记忆） */
export const DEFAULT_LOCALE: SupportedLocale = 'zh';
