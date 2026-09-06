import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * 货币格式化（USD cents → $X.XX）
 *
 * 后端契约：所有金额字段以 cents（int）存储；前端展示时换算到 dollar。
 * 用 Intl.NumberFormat 不手写格式化（CLAUDE.md §代码风格）。
 */
export function formatCurrency(cents: number | undefined | null, locale = 'en-US'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

/**
 * UI locale → Intl locale tag（语言优化方案 §2.5 映射表）
 *
 * zh→zh-CN、pt→pt、id→id；en→en-US；tet→en-US 回退（Intl 不支持 Tetum）。
 */
export function toIntlLocale(locale: string): string {
  switch (locale) {
    case 'zh':
      return 'zh-CN';
    case 'pt':
      return 'pt';
    case 'id':
      return 'id';
    default:
      return 'en-US';
  }
}

/**
 * 日期时间格式化（随 UI locale）
 *
 * 全站日期时间统一走此处，替代散落的 `new Date(x).toLocaleString()`（无 locale
 * 参数，不随 cookie 语言变化）。locale 传 UI locale（useLocale() 的值）。
 */
export function formatLocaleDateTime(value: string | number | Date, locale: string): string {
  return new Date(value).toLocaleString(toIntlLocale(locale));
}

/** 日期格式化（仅日期部分，随 UI locale） */
export function formatLocaleDate(value: string | number | Date, locale: string): string {
  return new Date(value).toLocaleDateString(toIntlLocale(locale));
}
