/**
 * 临期派生单测（P3体验增强 批1，方案v2 V1.3）
 *
 * 覆盖：
 * - 边界语义：shelfLifeDays − 已过天数 in {2,3,4} → isNearExpiry true/临界/false（阈值 3）
 * - shelfLifeDays 未录入 → daysToExpiry null / isNearExpiry false（不标）
 * - 阈值 config 生效（改阈值边界随之移动）
 * - 已过期（剩余 < 0）不标临期（过期是另一语义，MVP 不做）
 */
import { describe, it, expect } from 'vitest';
import { deriveNearExpiry, NEAR_EXPIRY_THRESHOLD_DAYS } from '../src/modules/catalog/near-expiry.config';

const NOW = new Date('2026-11-09T00:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('deriveNearExpiry（P3批1 临期派生）', () => {
  it('剩余 2 天（shelfLifeDays=5，已过 3 天）→ isNearExpiry true', () => {
    const r = deriveNearExpiry(5, daysAgo(3), NOW);
    expect(r.daysToExpiry).toBe(2);
    expect(r.isNearExpiry).toBe(true);
  });

  it('剩余 3 天（临界内，shelfLifeDays=6，已过 3 天）→ isNearExpiry true（=阈值）', () => {
    const r = deriveNearExpiry(6, daysAgo(3), NOW);
    expect(r.daysToExpiry).toBe(3);
    expect(r.isNearExpiry).toBe(true);
  });

  it('剩余 4 天（shelfLifeDays=7，已过 3 天）→ isNearExpiry false（超阈值）', () => {
    const r = deriveNearExpiry(7, daysAgo(3), NOW);
    expect(r.daysToExpiry).toBe(4);
    expect(r.isNearExpiry).toBe(false);
  });

  it('剩余 0 天（shelfLifeDays=3，已过 3 天）→ isNearExpiry true（当天到期仍标）', () => {
    const r = deriveNearExpiry(3, daysAgo(3), NOW);
    expect(r.daysToExpiry).toBe(0);
    expect(r.isNearExpiry).toBe(true);
  });

  it('已过期（剩余 -1）→ isNearExpiry false（过期非临期，MVP 不做）', () => {
    const r = deriveNearExpiry(2, daysAgo(3), NOW);
    expect(r.daysToExpiry).toBe(-1);
    expect(r.isNearExpiry).toBe(false);
  });

  it('shelfLifeDays null/undefined → 不标（daysToExpiry null / isNearExpiry false）', () => {
    expect(deriveNearExpiry(null, daysAgo(1), NOW)).toEqual({ daysToExpiry: null, isNearExpiry: false });
    expect(deriveNearExpiry(undefined, daysAgo(1), NOW)).toEqual({ daysToExpiry: null, isNearExpiry: false });
  });

  it('阈值 config 生效：阈值改 2 → 剩余 3 天不再标、剩余 2 天仍标', () => {
    expect(deriveNearExpiry(6, daysAgo(3), NOW, 2).isNearExpiry).toBe(false);
    expect(deriveNearExpiry(5, daysAgo(3), NOW, 2).isNearExpiry).toBe(true);
  });

  it('默认阈值常量为 3（方案v2 D1d 拍板值）', () => {
    expect(NEAR_EXPIRY_THRESHOLD_DAYS).toBe(3);
  });
});
