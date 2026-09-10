/**
 * Warehouse operatingHours helper — 保证金拦截链批A（A3，2026-09-10）
 *
 * 方案：方案v2-保证金拦截链与可配化-20260910 §2.2（T5-a/b/c/d）
 *
 * 数据形态（Warehouse.operatingHours Json?，契约 warehouse.ts OperatingHours 同构）：
 *   `{ mon..sun: { open: 'HH:mm' | '', close: 'HH:mm' | '', rest?: boolean } }`
 *   - rest: true 或 open/close 为空字符串 = 休息日（不营业）
 *   - 本期不跨天（T5-d 拍板）：close <= open 的日 = 异常数据 → 视为该日打烊 + log.warn
 *
 * 防御解析（v2 风险 1）：
 *   - operatingHours 为 null / 非对象 / 缺当日键 → 视为 24h 营业（保守不打烊）
 *   - 字段格式非法（非 HH:mm）→ 视为该日打烊 + log.warn，不抛错
 *
 * 下单语义（单仓匹配 + 打烊即预约，v2 T5-a）：
 *   - open = true  → 即时单（scheduledFor=null）
 *   - open = false → 预约单，nextOpenAt = 该仓下一次开门时间（今日未到 open → 今日 open；
 *     已过 close / 休息日 / 打烊异常 → 顺延到下一个营业日的 open）
 *
 * 时区（审查报告 P1-2，2026-09-10）：营业时间 JSON 是东帝汶本地墙钟（seed 08:00-22:00
 * 语义 = Dili 时间）。判定/构造一律显式 Asia/Dili，与 order-no.service.ts:64-70 /
 * shared/statistics/range.ts 仓内惯例一致——Date.getHours() 走进程本地时区，dev 机
 * UTC+8 与 Dili UTC+9 差 1h 已错判，生产容器（大概率 UTC）差 9h。东帝汶无夏令时。
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('WarehouseHours');

/** 东帝汶时区（UTC+9，无夏令时）——营业时间 JSON 的语义时区 */
export const WAREHOUSE_TZ = 'Asia/Dili';

/** Dili = UTC+9 固定偏移毫秒（无 DST，直接算术安全；range.ts diliDateStringToUtc 同款） */
const DILI_OFFSET_MS = 9 * 3600 * 1000;

/** 星期键（三字母小写，与 seed.ts OPERATING_HOURS / 契约 OperatingHours 同构） */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type DayKey = (typeof DAY_KEYS)[number];

/** 单日营业时段（原始 JSON 形态） */
interface DayHours {
  open?: unknown;
  close?: unknown;
  rest?: unknown;
}

/** operatingHours 顶层形态（宽松，运行时防御） */
export type OperatingHoursLike = Record<string, unknown> | null | undefined;

/** "HH:mm" → 当日分钟数；非法返回 null */
function parseHHmm(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Date → Dili 墙钟分解（时/分/星期键）
 *
 * 用 Intl.DateTimeFormat 而非手动偏移（order-no.service.ts 先例；虽然东帝汶无 DST
 * 手动 +9 也可，但保持全仓一个口径）。weekday 用 en-US 显式英文缩写，不依赖进程 locale。
 */
function diliParts(d: Date): { hour: number; minute: number; dayKey: DayKey } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: WAREHOUSE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = dtf.formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  // hour12:false 下 midnight 在部分运行时输出 "24"，归一到 0
  const hourRaw = Number(get('hour'));
  const hour = hourRaw === 24 ? 0 : hourRaw;
  const weekday = get('weekday').toLowerCase() as DayKey;
  return { hour, minute: Number(get('minute')), dayKey: weekday };
}

/**
 * "Dili 当日（相对 base 偏移 offsetDays 天）的 open 分钟数" → UTC instant
 *
 * 墙钟日期 + 墙钟分钟 → 真实时间戳：Date.UTC(墙钟) − 9h（Dili = UTC+9）。
 */
function diliWallToInstant(base: Date, offsetDays: number, minutes: number): Date {
  // 以 base 的 Dili 墙钟 0 点为锚，推 offsetDays 天
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: WAREHOUSE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const anchor = new Date(Date.parse(`${dtf.format(base)}T00:00:00Z`) + offsetDays * 86_400_000);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(anchor);
  // 墙钟当 UTC → 减 Dili 偏移得真实 instant
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + minutes * 60_000 - DILI_OFFSET_MS);
}

/**
 * 仓库当前是否营业（本期不跨天，T5-d）
 *
 * @param operatingHours Warehouse.operatingHours（Json?，可 null/畸形）
 * @param now 判定时刻（默认当前；测试注入用——传 UTC instant，内部按 Dili 墙钟判定）
 * @returns true=营业中（含"无配置=24h 营业"防御）；false=打烊/休息日/异常数据
 */
export function isWarehouseOpen(operatingHours: OperatingHoursLike, now: Date = new Date()): boolean {
  // 无配置 → 保守视为 24h 营业（不打烊，v2 风险 1）
  if (!operatingHours || typeof operatingHours !== 'object') return true;

  const { hour, minute, dayKey } = diliParts(now);
  const day = operatingHours[dayKey] as DayHours | undefined;
  // 缺当日键 → 同样保守视为营业
  if (!day || typeof day !== 'object') return true;

  // 休息日
  if (day.rest === true) return false;

  const open = parseHHmm(day.open);
  const close = parseHHmm(day.close);
  // open/close 空字符串 = 休息日（seed/契约同语义）
  if (day.open === '' || day.close === '') return false;
  // 格式非法 → 视为该日打烊（异常数据显式暴露）
  if (open === null || close === null) {
    logger.warn({
      msg: 'OPERATING_HOURS_MALFORMED',
      day: dayKey,
      open: String(day.open),
      close: String(day.close),
    });
    return false;
  }
  // 跨零点异常数据（close <= open）→ 本期不支持，视为该日打烊 + log.warn（T5-d 拍板）
  if (close <= open) {
    logger.warn({
      msg: 'OPERATING_HOURS_OVERNIGHT_UNSUPPORTED',
      day: dayKey,
      open: day.open,
      close: day.close,
    });
    return false;
  }

  const nowMin = hour * 60 + minute;
  return nowMin >= open && nowMin < close;
}

/**
 * 该仓下一次开门时间（含跨日推算：今日已过 close → 明日 open；最多扫 7 天）
 *
 * 前提：isWarehouseOpen(operatingHours, now) === false 时调用才有意义；
 * 无配置（24h 营业防御路径）→ 返回 null（调用方不应走预约路径）。
 *
 * @returns 下一次开门的 UTC instant（= Dili 墙钟 open 时刻）；7 天内全无营业日 → null
 */
export function nextOpenAt(operatingHours: OperatingHoursLike, now: Date = new Date()): Date | null {
  if (!operatingHours || typeof operatingHours !== 'object') return null;

  const { hour, minute, dayKey } = diliParts(now);
  const nowMin = hour * 60 + minute;
  const baseDayIndex = DAY_KEYS.indexOf(dayKey);

  // 从今天开始扫 7 天（8 次迭代兜底，理论上 7 天覆盖全周）
  for (let offset = 0; offset < 8; offset++) {
    const key = DAY_KEYS[(baseDayIndex + offset) % 7];
    const hours = operatingHours[key] as DayHours | undefined;
    if (!hours || typeof hours !== 'object') {
      // 该日无配置：offset=0 时走"今日 24h 营业"防御语义不应到这（open=true 不会调进来）；
      // 后续日缺键同样保守视为从 00:00 营业 → 返回该日 Dili 00:00
      return diliWallToInstant(now, offset, 0);
    }
    if (hours.rest === true) continue;
    if (hours.open === '' || hours.close === '') continue;
    const open = parseHHmm(hours.open);
    const close = parseHHmm(hours.close);
    if (open === null || close === null || close <= open) continue; // 畸形/跨零点日跳过（warn 已在 isWarehouseOpen 记）
    // 今天：还没到开门点 → 今天 open；已过开门点 → 看下一天
    if (offset === 0 && nowMin >= open) continue;
    return diliWallToInstant(now, offset, open);
  }
  return null;
}

/** 仅供单测断言口径（diliParts 不外露）——测试比对 Dili 墙钟读数用 */
export function diliWallMinutesForTest(d: Date): { hour: number; minute: number; dayKey: DayKey } {
  return diliParts(d);
}
