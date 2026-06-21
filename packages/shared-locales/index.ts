/**
 * @meimart/shared-locales 入口
 *
 * 三端共享 i18n 翻译资源（en/zh/id/pt/tet）。
 * Tetum 留空字符串占位（fallback 链 lang → en → ""）。
 *
 * 用法：
 *   import { messages, SUPPORTED_LOCALES, type Locale } from '@meimart/shared-locales';
 *   const t = messages.zh.errors['E-AUTH-001'];
 *
 * D5-T2 阶段：仅 export errors bundle（AllExceptionsFilter 用）
 * D5-T1 阶段：补 common/auth/user/shop/warehouse/order/payment/catalog（120 key）
 */
import enErrors from './en/errors.json';
import zhErrors from './zh/errors.json';
import idErrors from './id/errors.json';
import ptErrors from './pt/errors.json';
import tetErrors from './tet/errors.json';

export const SUPPORTED_LOCALES = ['en', 'zh', 'id', 'pt', 'tet'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** 错误码翻译 bundle（D5-T2） */
export const errorBundles: Record<Locale, Record<string, string>> = {
  en: enErrors,
  zh: zhErrors,
  id: idErrors,
  pt: ptErrors,
  tet: tetErrors,
};

/**
 * 完整 messages（D5-T1 扩展）
 *
 * 目前仅含 errors，D5-T1 完成后会含 common/auth/user/shop/warehouse/order/payment/catalog
 */
export const messages: Record<Locale, { errors: Record<string, string> }> = {
  en: { errors: enErrors },
  zh: { errors: zhErrors },
  id: { errors: idErrors },
  pt: { errors: ptErrors },
  tet: { errors: tetErrors },
};
