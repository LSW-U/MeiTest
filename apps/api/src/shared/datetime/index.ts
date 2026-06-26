/**
 * 时区工具（流程 M W3 — getYesterday 时区 bug 修复）
 *
 * 决策依据：
 *   - 审查报告 P0 #2：toISOString().slice(0,10) 返回 UTC 日期，02:00 Asia/Dili 跑 T+1 时错一天
 *   - 市场锁定 Asia/Dili（UTC+9）
 *
 * 实现：用 Intl.DateTimeFormat 按指定时区格式化 YYYY-MM-DD，避免 toISOString 转 UTC
 */

/** 项目锁定时区（东帝汶） */
export const MARKET_TIMEZONE = 'Asia/Dili';

/**
 * 取指定时区下"昨天"的 YYYY-MM-DD 字符串
 *
 * @param tz IANA 时区，默认 Asia/Dili
 */
export function getYesterdayInTz(tz: string = MARKET_TIMEZONE): string {
  return getDaysAgoInTz(1, tz);
}

/**
 * 取指定时区下"N 天前"的 YYYY-MM-DD 字符串
 *
 * 实现：用 Intl.DateTimeFormat 把当前 instant 按 tz 格式化，再回退 N 天。
 * 关键：CalendarDate 计算（year/month/day）必须在 tz 下完成，不能走 UTC。
 */
export function getDaysAgoInTz(daysAgo: number, tz: string = MARKET_TIMEZONE): string {
  const now = new Date();
  // 先按 tz 取当前 year/month/day
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value) - 1;
  const d = Number(parts.find((p) => p.type === 'day')!.value);
  // 在 tz 日历上下 daysAgo 天（自动跨月跨年）
  const target = new Date(Date.UTC(y, m, d) - daysAgo * 24 * 3600 * 1000);
  return target.toISOString().slice(0, 10);
}

/**
 * 校验字符串是否 YYYY-MM-DD 格式 + 真实合法日期（拒绝 2/30 等）
 *
 * V8 的 Date.parse 对 '2026-02-30' 是宽容解析（roll over 到 3/2），
 * 因此除了正则 + Date.parse 还要 round-trip 校验：parsed 回到 YYYY-MM-DD 必须与输入一致。
 */
export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const dt = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.toISOString().slice(0, 10) === s;
}
