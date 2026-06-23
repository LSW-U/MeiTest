import { describe, it, expect } from 'vitest';
import { buildRange, growthPct } from '../src/modules/platform/platform-time';

describe('platform-time / buildRange', () => {
  it("today: from=今日 00:00, prevFrom=昨日 00:00, 24 个小时桶", () => {
    const now = new Date('2026-06-23T15:30:00Z');
    const r = buildRange('today', now);

    expect(r.to.toISOString()).toBe('2026-06-23T15:30:00.000Z');
    expect(r.from.getUTCHours()).toBe(0);
    expect(r.bucketSecs).toBe(3600);
    expect(r.bucketCount).toBe(24);

    // 上一周期：前一日同时段
    const prevFromDay = r.prevFrom.getUTCDate();
    const currFromDay = r.from.getUTCDate();
    expect(prevFromDay).toBe(currFromDay - 1);

    // 桶格式化：今日 14 点 → '14:00'
    const sample = new Date('2026-06-23T14:00:00Z');
    expect(r.formatBucket(sample)).toMatch(/^\d{2}:00$/);
  });

  it("week: from=7 天前 00:00, prevFrom=14 天前, 7 个日桶", () => {
    const now = new Date('2026-06-23T15:30:00Z');
    const r = buildRange('week', now);

    const diffDays = (r.from.getTime() - r.prevFrom.getTime()) / (86400 * 1000);
    expect(diffDays).toBeCloseTo(7, 1);
    expect(r.bucketSecs).toBe(86400);
    expect(r.bucketCount).toBe(7);

    expect(r.formatBucket(r.from)).toBe(r.from.toISOString().slice(0, 10));
  });

  it("month: from=30 天前, prevFrom=60 天前, 30 个日桶", () => {
    const now = new Date('2026-06-23T15:30:00Z');
    const r = buildRange('month', now);

    const diffDays = (r.from.getTime() - r.prevFrom.getTime()) / (86400 * 1000);
    expect(diffDays).toBeCloseTo(30, 1);
    expect(r.bucketCount).toBe(30);
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
