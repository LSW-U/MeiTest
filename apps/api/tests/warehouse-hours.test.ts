/**
 * WarehouseHours helper 单测（保证金批A A3，2026-09-10；P1-2 时区修复后重写）
 *
 * 覆盖（任务书 A3 验收 ≥3 条，实际 9 条 + P1-2 时区专项 4 条）：
 *   - isWarehouseOpen：无配置=24h / 缺键防御 / 营业中 / 打烊 / 休息日 / 空字符串 /
 *     畸形格式 / 跨零点（close<=open，T5-d 不支持）→ 打烊
 *   - nextOpenAt：无配置→null / 今日未到 open→今日 / 已过→顺延 / rest 跳日 / 全 rest→null
 *
 * 时区口径（审查报告 P1-2 修复后）：营业时间 JSON 是 Dili 墙钟语义，helper 显式
 * Asia/Dili 取时。测试一律注入**固定 UTC instant**，断言 **Dili 墙钟**结果——
 * Dili = UTC+9，dev 机 = UTC+8（差 1h），刻意选跨差时段（UTC 23:xx = Dili 次日 08:xx）
 * 防 helper 回退成进程本地时区（本地时区读数会差 1h 或差一天，断言即红）。
 */
import { describe, it, expect } from 'vitest';
import {
  isWarehouseOpen,
  nextOpenAt,
  diliWallMinutesForTest,
} from '../src/shared/db/warehouse-hours';

/** 固定 UTC instant（Dili 墙钟语义由测试注释表达，helper 内部负责换算） */
function utcToDiliWall(y: number, mo: number, d: number, hUtc: number, miUtc: number): Date {
  // 直接构造 UTC instant；Dili 墙钟 = 该 instant 经 Asia/Dili 格式化（helper 内做，勿在此 +9h——双重偏移）
  return new Date(Date.UTC(y, mo - 1, d, hUtc, miUtc, 0, 0));
}

// 锚点：2026-09-10（周四）。UTC 2026-09-09 23:30 = Dili 2026-09-10 08:30（跨差时段）
const DILI_THU_0830 = utcToDiliWall(2026, 9, 9, 23, 30);
// UTC 2026-09-10 14:30 = Dili 2026-09-10 23:30（Dili 已打烊时段）
const DILI_THU_2330 = utcToDiliWall(2026, 9, 10, 14, 30);
// UTC 2026-09-10 20:30 = Dili 2026-09-11 05:30（Dili 周五凌晨）
const DILI_FRI_0530 = utcToDiliWall(2026, 9, 10, 20, 30);

/** 全周营业 08:00-20:00（Dili 墙钟语义） */
const FULL_WEEK = {
  mon: { open: '08:00', close: '20:00' },
  tue: { open: '08:00', close: '20:00' },
  wed: { open: '08:00', close: '20:00' },
  thu: { open: '08:00', close: '20:00' },
  fri: { open: '08:00', close: '20:00' },
  sat: { open: '08:00', close: '20:00' },
  sun: { open: '08:00', close: '20:00' },
};

describe('diliWallMinutesForTest（口径自检：helper 内部 Dili 分解正确）', () => {
  it('UTC 23:30（UTC+8 机为次日 07:30）→ Dili 08:30 周四', () => {
    const p = diliWallMinutesForTest(DILI_THU_0830);
    expect(p.hour).toBe(8);
    expect(p.minute).toBe(30);
    expect(p.dayKey).toBe('thu');
  });

  it('UTC 20:30 → Dili 次日 05:30 周五（日期已翻日）', () => {
    const p = diliWallMinutesForTest(DILI_FRI_0530);
    expect(p.hour).toBe(5);
    expect(p.dayKey).toBe('fri');
  });
});

describe('isWarehouseOpen（A3/T5-c 本期不跨天，Dili 墙钟）', () => {
  it('null / 非对象 → true（无配置=24h 营业防御，v2 风险 1）', () => {
    expect(isWarehouseOpen(null, DILI_THU_0830)).toBe(true);
    expect(isWarehouseOpen(undefined, DILI_THU_0830)).toBe(true);
    expect(isWarehouseOpen('oops' as never, DILI_THU_0830)).toBe(true);
  });

  it('缺当日键 → true（保守不打烊）', () => {
    const hours = { mon: { open: '08:00', close: '20:00' } }; // 只配周一
    expect(isWarehouseOpen(hours, DILI_THU_0830)).toBe(true); // 现在是 Dili 周四（缺 thu 键）
  });

  it('营业中（open ≤ now < close）→ true；打烊（now ≥ close / now < open）→ false', () => {
    expect(isWarehouseOpen(FULL_WEEK, DILI_THU_0830)).toBe(true); // Dili 08:30 营业中
    expect(isWarehouseOpen(FULL_WEEK, DILI_THU_2330)).toBe(false); // Dili 23:30 打烊
    // 边界：Dili 08:00 整 = 开门点营业；19:59 最后一分钟营业；20:00 整 = 打烊
    expect(isWarehouseOpen(FULL_WEEK, utcToDiliWall(2026, 9, 9, 23, 0))).toBe(true);
    expect(isWarehouseOpen(FULL_WEEK, utcToDiliWall(2026, 9, 10, 10, 59))).toBe(true); // Dili 19:59
    expect(isWarehouseOpen(FULL_WEEK, utcToDiliWall(2026, 9, 10, 11, 0))).toBe(false); // Dili 20:00
  });

  it('rest: true → false（休息日）', () => {
    const hours = { ...FULL_WEEK, thu: { open: '08:00', close: '20:00', rest: true } };
    expect(isWarehouseOpen(hours, DILI_THU_0830)).toBe(false);
  });

  it("open/close 空字符串 → false（休息日同语义）", () => {
    const hours = { ...FULL_WEEK, thu: { open: '', close: '' } };
    expect(isWarehouseOpen(hours, DILI_THU_0830)).toBe(false);
  });

  it('畸形格式（非 HH:mm）→ false + 不抛错', () => {
    const hours = { ...FULL_WEEK, thu: { open: '8am', close: '20:00' } };
    expect(isWarehouseOpen(hours, DILI_THU_0830)).toBe(false);
  });

  it('跨零点异常数据（close <= open）→ false（T5-d 拍板：本期不支持跨天营业）', () => {
    const hours = { ...FULL_WEEK, thu: { open: '22:00', close: '06:00' } };
    expect(isWarehouseOpen(hours, DILI_THU_2330)).toBe(false); // Dili 23:30 在 22:00-06:00 区间内，但跨零点不支持 → 打烊
    const equal = { ...FULL_WEEK, thu: { open: '08:00', close: '08:00' } };
    expect(isWarehouseOpen(equal, DILI_THU_0830)).toBe(false);
  });
});

describe('nextOpenAt（A3/T5-a 预约单下次开门时间，Dili 墙钟）', () => {
  it('无配置（24h 防御路径）→ null（调用方不应走预约）', () => {
    expect(nextOpenAt(null, DILI_THU_0830)).toBeNull();
  });

  it('今日未到 open → 返回今日 open（Dili 墙钟 08:00）', () => {
    // Dili 05:30（UTC 20:30 前一天）→ 今日 08:00 开门
    const next = nextOpenAt(FULL_WEEK, DILI_FRI_0530);
    expect(next).not.toBeNull();
    // 断言返回 instant 的 Dili 墙钟读数（不依赖进程时区）
    const p = diliWallMinutesForTest(next!);
    expect(p.dayKey).toBe('fri');
    expect(p.hour).toBe(8);
    expect(p.minute).toBe(0);
    // 与注入 UTC instant 的固定换算核对：Dili 周五 08:00 = UTC 周四 23:00
    expect(next!.toISOString()).toBe('2026-09-10T23:00:00.000Z');
  });

  it('今日已过 open（打烊后）→ 顺延到明天 open', () => {
    // Dili 23:30（周四深夜）→ 周五 08:00
    const next = nextOpenAt(FULL_WEEK, DILI_THU_2330);
    const p = diliWallMinutesForTest(next!);
    expect(p.dayKey).toBe('fri');
    expect(p.hour).toBe(8);
  });

  it('明日 rest → 跳到下一个营业日（周五 rest → 周六 08:00）', () => {
    const hours = { ...FULL_WEEK, fri: { open: '08:00', close: '20:00', rest: true } };
    const next = nextOpenAt(hours, DILI_THU_2330); // Dili 周四晚 → 周五 rest → 周六
    const p = diliWallMinutesForTest(next!);
    expect(p.dayKey).toBe('sat');
    expect(p.hour).toBe(8);
  });

  it('7 天全 rest / 全畸形 → null（无可用营业日）', () => {
    const allRest = Object.fromEntries(
      Object.keys(FULL_WEEK).map((k) => [k, { open: '08:00', close: '20:00', rest: true }]),
    );
    expect(nextOpenAt(allRest, DILI_THU_0830)).toBeNull();
  });
});

describe('P1-2 时区专项：进程本地时区（dev UTC+8）与 Dili（UTC+9）跨差时段防回退', () => {
  it('UTC 23:30 → Dili 08:30 营业中；若回退本地时区读数（UTC+8 机 07:30）会误判打烊', () => {
    // FULL_WEEK 08:00 开门：Dili 读数 08:30 → open；本地（UTC+8）读数 07:30 → closed（误）
    expect(isWarehouseOpen(FULL_WEEK, DILI_THU_0830)).toBe(true);
  });

  it('UTC 11:00 → Dili 20:00 打烊；若回退本地时区读数（19:00）会误判营业', () => {
    // close 20:00：Dili 读数 20:00 → 打烊；本地（UTC+8）读数 19:00 → 营业中（误）
    expect(isWarehouseOpen(FULL_WEEK, utcToDiliWall(2026, 9, 10, 11, 0))).toBe(false);
  });

  it('UTC 15:30 → Dili 次日 00:30，星期键已翻日（thu→fri）；回退本地读数仍是 thu', () => {
    // 区分用例：thu rest + fri 全天营业。Dili 正解 = 周五 00:30 → 全天营业 → true；
    // 回退本地时区读数 = 周四 23:30 → thu rest → false（误判）。
    const hours = {
      ...FULL_WEEK,
      thu: { open: '08:00', close: '20:00', rest: true },
      fri: { open: '00:00', close: '23:59' },
    };
    expect(isWarehouseOpen(hours, utcToDiliWall(2026, 9, 10, 15, 30))).toBe(true);
    // 且 nextOpenAt 视角：Dili 周五 00:30，08:00 未到 → 今日（周五）08:00
    const next = nextOpenAt(FULL_WEEK, utcToDiliWall(2026, 9, 10, 15, 30));
    expect(diliWallMinutesForTest(next!).dayKey).toBe('fri');
  });

  it('nextOpenAt 返回 instant 精确到毫秒（Dili 08:00 = UTC 前日 23:00，非本地 setHours 产物）', () => {
    // 本地时区实现（setHours(8,0)）在 UTC+8 机上会产出 UTC 前日 16:00 —— 与 Dili 正解差 7h
    const next = nextOpenAt(FULL_WEEK, DILI_FRI_0530);
    expect(next!.getTime()).toBe(Date.UTC(2026, 8, 10, 23, 0, 0, 0));
  });
});
