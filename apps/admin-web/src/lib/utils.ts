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
