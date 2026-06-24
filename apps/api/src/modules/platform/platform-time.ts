/**
 * Dashboard 时间范围与增长率计算（纯函数，便于单测）
 *
 * 抽离原因：dashboard.service.ts 依赖 db，纯逻辑部分单独测试更稳。
 *
 * 时区口径（2026-06-24 修复 B2/m9）：
 *   - 市场锁定 Asia/Dili UTC+9（CLAUDE.md 顶部）
 *   - buildRange 返回的 from/to/prevFrom/prevTo 都是 UTC 时间戳（JS Date）
 *   - 但起点切在 Dili 当地 0:00（不是 UTC 0:00），避免早 0~9 点看板显示"今日 ≈ 0"
 *   - formatBucket 用 Dili 当地小时/日期格式化，前端直接展示
 *   - prevTo = to（不再是 from），保证 prev 段与 current 段长度一致
 */

export interface Range {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** trend bucket 大小（秒） */
  bucketSecs: number;
  bucketCount: number;
  formatBucket: (d: Date) => string;
}

export const DILI_TZ = 'Asia/Dili';

/**
 * 取某个 Date 在 Dili 当地时区下的 yyyy-MM-dd 字符串。
 * 用 Intl 而非 date-fns-tz，避免引入新依赖。
 */
function toDiliDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DILI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * 把"Dili 当地某个日期 00:00"转成 UTC 时间戳。
 *
 * 例：dili 2026-06-23 00:00 → UTC 2026-06-22 15:00（因为 Dili = UTC+9）
 *
 * 关键点：`Date.parse('YYYY-MM-DDT00:00:00')` 不带 Z 后缀会按运行时本地时区解析，
 * 导致服务器时区不同结果不同。必须显式带 Z 后缀按 UTC 解析。
 */
function diliMidnightToUtc(d: Date): Date {
  const dateStr = toDiliDateString(d); // 'YYYY-MM-DD'
  // wallMs = "Dili 当地 0:00 这个墙上时间当作 UTC"的毫秒数
  const wallMs = Date.parse(`${dateStr}T00:00:00Z`);
  // Dili 比 UTC 早 9 小时（无夏令时），所以 Dili 0:00 对应 UTC 前一日 15:00
  return new Date(wallMs - 9 * 3600 * 1000);
}

/**
 * 在 UTC 基础上减 N 天，保持时刻不变。
 */
function minusDaysUtc(d: Date, days: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - days);
  return r;
}

export function buildRange<T extends 'today' | 'week' | 'month'>(
  range: T,
  now: Date = new Date(),
): Range {
  const to = new Date(now);
  let from: Date;
  let prevFrom: Date;
  let prevTo: Date;
  let bucketSecs: number;
  let bucketCount: number;
  let formatBucket: (d: Date) => string;

  if (range === 'today') {
    from = diliMidnightToUtc(now);
    // 修复 m9：prev 段 = current 段往前平移 1 天，保证长度一致
    // 业务语义："今早 0~6 点 vs 昨早 0~6 点"
    prevFrom = minusDaysUtc(from, 1);
    prevTo = minusDaysUtc(to, 1);
    bucketSecs = 3600;
    bucketCount = 24;
    formatBucket = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: DILI_TZ,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
  } else if (range === 'week') {
    const todayMidnight = diliMidnightToUtc(now);
    from = minusDaysUtc(todayMidnight, 6);
    prevFrom = minusDaysUtc(from, 7);
    prevTo = minusDaysUtc(to, 7);
    bucketSecs = 86400;
    bucketCount = 7;
    formatBucket = (d: Date) => toDiliDateString(d);
  } else {
    const todayMidnight = diliMidnightToUtc(now);
    from = minusDaysUtc(todayMidnight, 29);
    prevFrom = minusDaysUtc(from, 30);
    prevTo = minusDaysUtc(to, 30);
    bucketSecs = 86400;
    bucketCount = 30;
    formatBucket = (d: Date) => toDiliDateString(d);
  }

  return { from, to, prevFrom, prevTo, bucketSecs, bucketCount, formatBucket };
}

export function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Number((((current - prev) / prev) * 100).toFixed(2));
}
