import { describe, it, expect } from 'vitest';
import { buildRange, growthPct, DILI_TZ } from '../src/modules/platform/platform-time';

/**
 * 时区口径（2026-06-24 B2 修复后）：
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
