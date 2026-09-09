import { describe, it, expect } from 'vitest';
import {
  buildRange,
  growthPct,
  DILI_TZ,
  MAX_RANGE_DAYS,
} from '../src/shared/statistics/range';

/**
 * 时区口径（2026-06-24 B2 修复后；批A 2026-09-09 平移至 shared/statistics/range.ts）：
 *   - 市场锁定 Asia/Dili UTC+9（Dili 比 UTC 早 9 小时）
 *   - buildRange 返回的 from/to 都是 UTC 时间戳（JS Date）
 *   - from 切在 Dili 当地 0:00，对应 UTC 前一日 15:00
 *   - formatBucket 输出 Dili 当地小时/日期
 */
describe('platform-time / buildRange (Asia/Dili 口径)', () => {
  it("today: from=Dili 当地 0:00（UTC 前日 15:00），24 个小时桶", () => {
    // Dili 当地 2026-06-24 00:30 = UTC 2026-06-23 15:30
    const now = new Date('2026-06-23T15:30:00Z');
    const r = buildRange('today', now);

    expect(r.to.toISOString()).toBe('2026-06-23T15:30:00.000Z');
    // from = Dili 当地 2026-06-24 00:00 = UTC 2026-06-23 15:00
    expect(r.from.toISOString()).toBe('2026-06-23T15:00:00.000Z');
    expect(r.bucketSecs).toBe(3600);
    expect(r.bucketCount).toBe(24);

    // m9 修复：prev = current 段往前平移 1 天，保证长度一致
    // current = [Dili 今日 0:00, now]，prev = [Dili 昨日 0:00, now - 1 day]
    expect(r.prevFrom.toISOString()).toBe('2026-06-22T15:00:00.000Z'); // Dili 昨日 0:00
    expect(r.prevTo.toISOString()).toBe('2026-06-22T15:30:00.000Z'); // now - 1 day

    // formatBucket：用 Dili 当地小时格式化
    // UTC 14:00 → Dili 23:00
    const sample = new Date('2026-06-23T14:00:00Z');
    expect(r.formatBucket(sample)).toBe('23:00');
  });

  it("today: UTC 0:00 ~ 9:00 不会被切到昨天（早高峰场景）", () => {
    // UTC 2026-06-23 04:00 = Dili 2026-06-23 13:00（下午 1 点）
    const now = new Date('2026-06-23T04:00:00Z');
    const r = buildRange('today', now);

    // Dili 2026-06-23 00:00 = UTC 2026-06-22 15:00
    expect(r.from.toISOString()).toBe('2026-06-22T15:00:00.000Z');
    // 这是 Dili 当地的"今日起点"，不是 UTC 的昨日
  });

  it("week: from=6 天前 Dili 0:00，prevFrom = to - 7 天", () => {
    const now = new Date('2026-06-23T15:30:00Z'); // Dili 2026-06-24 00:30
    const r = buildRange('week', now);

    // today Dili 0:00 = UTC 2026-06-23 15:00
    // from = today - 6 days = UTC 2026-06-17 15:00
    expect(r.from.toISOString()).toBe('2026-06-17T15:00:00.000Z');
    // m9 修复：prev = current 段往前平移 7 天
    // prevFrom = from - 7 days = UTC 2026-06-10 15:00
    expect(r.prevFrom.toISOString()).toBe('2026-06-10T15:00:00.000Z');
    // prevTo = to - 7 days = UTC 2026-06-16 15:30
    expect(r.prevTo.toISOString()).toBe('2026-06-16T15:30:00.000Z');
    expect(r.bucketSecs).toBe(86400);
    expect(r.bucketCount).toBe(7);

    // formatBucket：Dili 当地日期
    expect(r.formatBucket(r.from)).toBe('2026-06-18'); // UTC 2026-06-17 15:00 → Dili 2026-06-18 00:00
  });

  it("month: from=29 天前 Dili 0:00，prevFrom = from - 30 天", () => {
    const now = new Date('2026-06-23T15:30:00Z');
    const r = buildRange('month', now);

    expect(r.from.toISOString()).toBe('2026-05-25T15:00:00.000Z');
    expect(r.prevFrom.toISOString()).toBe('2026-04-25T15:00:00.000Z');
    expect(r.prevTo.toISOString()).toBe('2026-05-24T15:30:00.000Z');
    expect(r.bucketCount).toBe(30);
  });

  it("prev 段长度与 current 段长度一致（m9 修复）", () => {
    const now = new Date('2026-06-23T15:30:00Z'); // Dili 6 月 24 日 00:30
    for (const range of ['today', 'week', 'month'] as const) {
      const r = buildRange(range, now);
      const currentMs = r.to.getTime() - r.from.getTime();
      const prevMs = r.prevTo.getTime() - r.prevFrom.getTime();
      expect(prevMs).toBe(currentMs);
    }
  });
});

describe('platform-time / growthPct', () => {
  it('前值为 0 且当前 > 0 → 返回 100（新数据 baseline）', () => {
    expect(growthPct(500, 0)).toBe(100);
  });

  it('前值为 0 且当前 = 0 → 返回 0（无数据 baseline）', () => {
    expect(growthPct(0, 0)).toBe(0);
  });

  it('正增长', () => {
    expect(growthPct(150, 100)).toBe(50);
  });

  it('负增长', () => {
    expect(growthPct(80, 100)).toBe(-20);
  });

  it('保留两位小数', () => {
    expect(growthPct(123, 100)).toBe(23);
    expect(growthPct(100, 3)).toBeCloseTo(3233.33, 1);
  });
});

describe('platform-time / DILI_TZ', () => {
  it('DILI_TZ 是 Asia/Dili', () => {
    expect(DILI_TZ).toBe('Asia/Dili');
  });
});

/**
 * 批A 扩展（2026-09-09）：buildRange 自定义 from/to
 * 规则：from/to 都是 Dili 当地日期（YYYY-MM-DD），含头尾；
 *      查询区间 = [from 日 0:00, to+1 日 0:00)，Dili 切日与预设一致；
 *      to<from / 非法格式 / 非真实日历日期 → 400 E-STATISTICS-001；
 *      跨期 > 366 天 → 400 E-STATISTICS-002。
 */
describe('platform-time / buildRange 自定义 from/to（批A 扩展）', () => {
  it('单日（from=to）：区间 = Dili 当天 0:00 ~ 次日 0:00，24 小时桶', () => {
    const r = buildRange({ from: '2026-06-23', to: '2026-06-23' });
    // Dili 2026-06-23 00:00 = UTC 2026-06-22 15:00
    expect(r.from.toISOString()).toBe('2026-06-22T15:00:00.000Z');
    // 排他上界 = 次日 0:00 = UTC 2026-06-23 15:00
    expect(r.to.toISOString()).toBe('2026-06-23T15:00:00.000Z');
    expect(r.bucketSecs).toBe(3600);
    expect(r.bucketCount).toBe(24);
    expect(r.formatBucket(new Date('2026-06-22T14:00:00Z'))).toBe('23:00');
  });

  it('跨日（from<to）：含头尾，天桶，bucketCount=天数', () => {
    const r = buildRange({ from: '2026-06-20', to: '2026-06-23' }); // 4 天
    expect(r.from.toISOString()).toBe('2026-06-19T15:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-06-23T15:00:00.000Z'); // to+1 日 0:00
    expect(r.bucketSecs).toBe(86400);
    expect(r.bucketCount).toBe(4);
    expect(r.formatBucket(r.from)).toBe('2026-06-20');
  });

  it('prev 段与 current 段等长（m9 同规则）', () => {
    const r = buildRange({ from: '2026-06-01', to: '2026-06-15' }); // 含头尾 15 天
    const spanMs = r.to.getTime() - r.from.getTime();
    expect(r.prevTo.getTime() - r.prevFrom.getTime()).toBe(spanMs);
    expect(r.prevFrom.toISOString()).toBe('2026-05-16T15:00:00.000Z');
    expect(r.prevTo.toISOString()).toBe('2026-05-31T15:00:00.000Z');
  });

  /** 断言抛 400 + 错误码（BadRequestException 把 code 放在 response 里） */
  function expectRangeError(input: { from: string; to: string }, code: string) {
    let caught: unknown;
    try {
      buildRange(input);
    } catch (e) {
      caught = e;
    }
    expect((caught as { status?: number })?.status).toBe(400);
    expect((caught as { response?: { code?: string } })?.response?.code).toBe(code);
  }

  it('to < from → 400 E-STATISTICS-001', () => {
    expectRangeError({ from: '2026-06-23', to: '2026-06-20' }, 'E-STATISTICS-001');
  });

  it('格式非法（非 YYYY-MM-DD）→ 400 E-STATISTICS-001', () => {
    expectRangeError({ from: '2026/06/20', to: '2026-06-23' }, 'E-STATISTICS-001');
    expectRangeError({ from: '2026-6-2', to: '2026-06-23' }, 'E-STATISTICS-001');
  });

  it('非真实日历日期（2026-02-30）→ 400 E-STATISTICS-001', () => {
    expectRangeError({ from: '2026-02-30', to: '2026-03-05' }, 'E-STATISTICS-001');
  });

  it(`恰好 ${MAX_RANGE_DAYS} 天（含头尾）→ 通过`, () => {
    // 366 天跨度：from 2025-06-23 → to 2026-06-23（含头尾 366 天）
    const from = new Date('2025-06-23T00:00:00Z');
    const to = new Date(from.getTime() + (MAX_RANGE_DAYS - 1) * 86400 * 1000);
    const toStr = to.toISOString().slice(0, 10);
    const r = buildRange({ from: '2025-06-23', to: toStr });
    const spanDays = Math.round((r.to.getTime() - r.from.getTime()) / (86400 * 1000));
    expect(spanDays).toBe(MAX_RANGE_DAYS);
  });

  it(`超过 ${MAX_RANGE_DAYS} 天 → 400 E-STATISTICS-002`, () => {
    const from = new Date('2025-06-23T00:00:00Z');
    const to = new Date(from.getTime() + MAX_RANGE_DAYS * 86400 * 1000);
    const toStr = to.toISOString().slice(0, 10);
    expectRangeError({ from: '2025-06-23', to: toStr }, 'E-STATISTICS-002');
  });

  it('Dili 切日边界：Dili 当地 0:30 仍属当日（UTC 前日 15:30）', () => {
    // 自定义 from=Dili 2026-06-23，UTC 2026-06-22 15:30（Dili 06-24 00:30）落在区间内
    const r = buildRange({ from: '2026-06-23', to: '2026-06-23' });
    const probe = new Date('2026-06-22T15:30:00Z'); // Dili 06-23 00:30
    expect(probe >= r.from && probe < r.to).toBe(true);
    // UTC 2026-06-22 14:59（Dili 06-22 23:59）落在区间外
    const before = new Date('2026-06-22T14:59:00Z');
    expect(before >= r.from && before < r.to).toBe(false);
  });
});
