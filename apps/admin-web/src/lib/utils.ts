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
 * 人民币格式化（CNY cents → ¥X.XX）
 *
 * 批C 对账台账用：台账 amountCny 为可空（纯 USD 资金流 null → 显示 —）；
 * 快照口径（批A 下单锁汇率），非实时汇率。
 */
export function formatCny(cents: number | undefined | null, locale = 'en-US'): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
  }).format(cents / 100);
}
