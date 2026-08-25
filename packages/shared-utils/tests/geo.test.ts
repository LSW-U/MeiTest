/**
 * geo.ts 单测 — Haversine 距离 + ETA 推导（P6 #7，2026-08-25）
 */
import { describe, it, expect } from 'vitest';
import { haversineDistanceKm, estimateMinutesFromDistance } from '../src/geo';

describe('haversineDistanceKm', () => {
  it('同点 → 0 km', () => {
    expect(haversineDistanceKm(-8.5568, 125.56, -8.5568, 125.56)).toBeCloseTo(0, 6);
  });

  it('Dili → 大约 1km 范围（市内配送典型）', () => {
    // Dili 中心两点相距约 1km
    const d = haversineDistanceKm(-8.5568, 125.5600, -8.5500, 125.5660)!;
    expect(d).toBeGreaterThan(0.8);
    expect(d).toBeLessThan(1.5);
  });

  it('已知长距离近似值（Dili → Kupang ≈ 280km）', () => {
    const d = haversineDistanceKm(-8.5568, 125.56, -10.1772, 123.6056)!;
    expect(d).toBeGreaterThan(260);
    expect(d).toBeLessThan(300);
  });

  it('坐标缺失 / 非有限 → null', () => {
    expect(haversineDistanceKm(NaN, 125.56, -8.55, 125.56)).toBeNull();
    expect(haversineDistanceKm(-8.55, Infinity, -8.55, 125.56)).toBeNull();
  });
});

describe('estimateMinutesFromDistance', () => {
  it('5km @ 20km/h → 15 分钟', () => {
    expect(estimateMinutesFromDistance(5)).toBe(15);
  });

  it('10km @ 20km/h = 30 分钟，低于上限 45', () => {
    expect(estimateMinutesFromDistance(10)).toBe(30);
  });

  it('超长距离 → 上限 45 分钟兜底（不做实时路况）', () => {
    // 100km @ 20 = 300 分钟，但兜底 45
    expect(estimateMinutesFromDistance(100)).toBe(45);
  });

  it('自定义时速 + 上限', () => {
    expect(estimateMinutesFromDistance(10, 30, 60)).toBe(20);
  });

  it('非法距离 → null', () => {
    expect(estimateMinutesFromDistance(NaN)).toBeNull();
    expect(estimateMinutesFromDistance(-1)).toBeNull();
  });

  it('0 距离 → 0 分钟', () => {
    expect(estimateMinutesFromDistance(0)).toBe(0);
  });
});
