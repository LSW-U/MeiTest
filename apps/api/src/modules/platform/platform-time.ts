/**
 * Dashboard 时间范围与增长率计算（纯函数，便于单测）
 *
 * 抽离原因：dashboard.service.ts 依赖 db，纯逻辑部分单独测试更稳。
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
    from = new Date(to);
    from.setUTCHours(0, 0, 0, 0);
    prevTo = new Date(from);
    prevFrom = new Date(from);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - 1);
    bucketSecs = 3600;
    bucketCount = 24;
    formatBucket = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:00`;
  } else if (range === 'week') {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 6);
    from.setUTCHours(0, 0, 0, 0);
    prevTo = new Date(from);
    prevFrom = new Date(from);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - 7);
    bucketSecs = 86400;
    bucketCount = 7;
    formatBucket = (d: Date) => d.toISOString().slice(0, 10);
  } else {
    from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 29);
    from.setUTCHours(0, 0, 0, 0);
    prevTo = new Date(from);
    prevFrom = new Date(from);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - 30);
    bucketSecs = 86400;
    bucketCount = 30;
    formatBucket = (d: Date) => d.toISOString().slice(0, 10);
  }

  return { from, to, prevFrom, prevTo, bucketSecs, bucketCount, formatBucket };
}

export function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Number((((current - prev) / prev) * 100).toFixed(2));
}
