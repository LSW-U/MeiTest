/**
 * 时间工具：UTC+9（东帝汶 Asia/Dili）
 *
 * 决策依据：
 * - 契约 v0.2 §1.3 + 本地化清单 §七
 * - 数据库存 UTC，显示 UTC+9
 * - 东帝汶无夏令时
 */

export const DILI_TIMEZONE = 'Asia/Dili';
export const DILI_OFFSET_HOURS = 9;

/** 当前 UTC ISO 时间 */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/** UTC ISO → 东帝汶时区显示字符串 */
export function formatInDili(iso: string, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: DILI_TIMEZONE,
    ...options,
  }).format(new Date(iso));
}

/** 东帝汶日期 yyyyMMdd（用于 orderNo） */
export function diliDateYyyyMMdd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DILI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/-/g, '');
}

/** 东帝汶日期 yyyy-MM-dd */
export function diliDateYyyyMmDd(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DILI_TIMEZONE,
  }).format(date);
}
