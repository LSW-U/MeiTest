/**
 * 统计时间范围与增长率计算（纯函数公共层，便于单测）
 *
 * 来源：数据分析报表模块 批A（2026-09-09）——自 `src/modules/platform/platform-time.ts`
 * 平移（原文件零 import 纯函数已核），dashboard 与 statistics 共用（A2 单一事实源）。
 *
 * 时区口径（2026-06-24 修复 B2/m9，平移保持不变）：
 *   - 市场锁定 Asia/Dili UTC+9（CLAUDE.md 顶部）
 *   - buildRange 返回的 from/to/prevFrom/prevTo 都是 UTC 时间戳（JS Date）
 *   - 但起点切在 Dili 当地 0:00（不是 UTC 0:00），避免早 0~9 点看板显示"今日 ≈ 0"
 *   - formatBucket 用 Dili 当地小时/日期格式化，前端直接展示
 *   - prevTo = to - span（m9 修复），保证 prev 段与 current 段长度一致
 *
 * 批A 扩展（唯一行为新增）：buildRange 支持自定义 from/to（YYYY-MM-DD），
 *   - 切日规则与预设一致（Dili 当地 0 点起算，to 为 to 日全天，含当天 → 排他上界 = to+1 天 0:00）
 *   - to < from / 格式非法 / 非真实日历日期 → 400 E-STATISTICS-001
 *   - 跨期（含头尾）超过 366 天 → 400 E-STATISTICS-002（防全表扫，v2 §3.2）
 */
import { BadRequestException } from '@nestjs/common';

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

/** 自定义时间范围入参（YYYY-MM-DD，Dili 当地日期） */
export interface CustomRangeInput {
  from: string;
  to: string;
}

/** 预设时间范围（与契约 DashboardTimeRange 对齐） */
export type PresetRangeType = 'today' | 'week' | 'month';

/** 自定义跨期上限（含头尾天数）；超限抛 400 E-STATISTICS-002（v2 §3.2 防全表扫） */
export const MAX_RANGE_DAYS = 366;

/** 错误码：时间范围参数非法（格式 / 非真实日期 / to < from） */
const ERR_INVALID_RANGE = 'E-STATISTICS-001';
/** 错误码：跨期超过 366 天上限 */
const ERR_RANGE_TOO_LONG = 'E-STATISTICS-002';

const YYYYMMDD_RE = /^\d{4}-\d{2}-\d{2}$/;

function throwInvalidRange(detail: string): never {
  throw new BadRequestException({
    code: ERR_INVALID_RANGE,
    message: `Invalid statistics date range: ${detail}`,
  });
}

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
 * 关键点：`Date.parse('YYYY-MM-DDT00:00:00Z')` 不带 Z 后缀会按运行时本地时区解析，
 * 导致服务器时区不同结果不同。必须显式带 Z 后缀按 UTC 解析。
 */
function diliMidnightToUtc(d: Date): Date {
  return diliDateStringToUtc(toDiliDateString(d));
}

/**
 * 把"Dili 当地日期字符串（YYYY-MM-DD）的 00:00"转成 UTC 时间戳。
 * 与 diliMidnightToUtc 同规则，供自定义 from/to 直接入口（字符串无需先造 Date）。
 */
function diliDateStringToUtc(dateStr: string): Date {
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

/** trend 小时桶格式化（Dili 当地 HH:mm） */
function formatHourBucket(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DILI_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** trend 日桶格式化（Dili 当地 YYYY-MM-DD） */
function formatDayBucket(d: Date): string {
  return toDiliDateString(d);
}

/**
 * 构建统计时间范围。
 *
 * 重载 1：预设（today/week/month）——行为与平移前 platform-time 完全一致，逻辑零改动。
 * 重载 2：自定义 { from, to }（YYYY-MM-DD，Dili 当地日期，含头尾）——批A 唯一扩展。
 */
export function buildRange(range: PresetRangeType, now?: Date): Range;
export function buildRange(range: CustomRangeInput, now?: Date): Range;
export function buildRange(
  range: PresetRangeType | CustomRangeInput,
  now: Date = new Date(),
): Range {
  if (typeof range !== 'string') {
    return buildCustomRange(range);
  }

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
    formatBucket = formatHourBucket;
  } else if (range === 'week') {
    const todayMidnight = diliMidnightToUtc(now);
    from = minusDaysUtc(todayMidnight, 6);
    prevFrom = minusDaysUtc(from, 7);
    prevTo = minusDaysUtc(to, 7);
    bucketSecs = 86400;
    bucketCount = 7;
    formatBucket = formatDayBucket;
  } else {
    const todayMidnight = diliMidnightToUtc(now);
    from = minusDaysUtc(todayMidnight, 29);
    prevFrom = minusDaysUtc(from, 30);
    prevTo = minusDaysUtc(to, 30);
    bucketSecs = 86400;
    bucketCount = 30;
    formatBucket = formatDayBucket;
  }

  return { from, to, prevFrom, prevTo, bucketSecs, bucketCount, formatBucket };
}

/** 校验 YYYY-MM-DD 是真实日历日期（Date.parse 对 '2026-02-30' 会 roll 到 3 月，不能用 NaN 判定） */
function isRealCalendarDate(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * 自定义时间范围（批A 扩展）。
 *
 * - from/to 都是 Dili 当地日期（YYYY-MM-DD），含头尾：查询区间 = [from 日 0:00, to+1 日 0:00)
 * - prev 段 = current 段按跨度整体前移（与预设 m9 规则一致）
 * - 桶粒度：单日 24 个小时桶；跨日按天桶（与预设 week/month 同构）
 */
function buildCustomRange({ from, to }: CustomRangeInput): Range {
  if (!YYYYMMDD_RE.test(from) || !YYYYMMDD_RE.test(to)) {
    throwInvalidRange(`from/to must be YYYY-MM-DD (got from=${from}, to=${to})`);
  }
  // Date.parse 对 '2026-02-30T00:00:00Z' 这类非真实日历日期会 roll 到 3 月而非 NaN，
  // 须先按日历语义校验
  if (!isRealCalendarDate(from) || !isRealCalendarDate(to)) {
    throwInvalidRange(`from/to is not a real calendar date (from=${from}, to=${to})`);
  }
  const fromDate = diliDateStringToUtc(from);
  const toDayStart = diliDateStringToUtc(to);
  if (toDayStart.getTime() < fromDate.getTime()) {
    throwInvalidRange(`to (${to}) must be >= from (${from})`);
  }

  // 排他上界 = to 日次日 0:00（Dili 无夏令时，+24h 即次日 0:00）
  const toExcl = new Date(toDayStart.getTime() + 24 * 3600 * 1000);
  const spanMs = toExcl.getTime() - fromDate.getTime();
  const spanDays = Math.round(spanMs / (24 * 3600 * 1000));
  if (spanDays > MAX_RANGE_DAYS) {
    throw new BadRequestException({
      code: ERR_RANGE_TOO_LONG,
      message: `Statistics date range exceeds ${MAX_RANGE_DAYS} days (got ${spanDays})`,
    });
  }

  // prev 段 = current 段按跨度前移（m9 同规则）
  const prevFrom = new Date(fromDate.getTime() - spanMs);
  const prevTo = new Date(toExcl.getTime() - spanMs);

  // 单日查询用小时桶（对齐 today 预设），跨日用天桶（对齐 week/month）
  const singleDay = spanDays === 1;

  return {
    from: fromDate,
    to: toExcl,
    prevFrom,
    prevTo,
    bucketSecs: singleDay ? 3600 : 86400,
    bucketCount: singleDay ? 24 : spanDays,
    formatBucket: singleDay ? formatHourBucket : formatDayBucket,
  };
}

export function growthPct(current: number, prev: number): number {
  if (prev === 0) return current > 0 ? 100 : 0;
  return Number((((current - prev) / prev) * 100).toFixed(2));
}
