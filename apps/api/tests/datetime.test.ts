/**
 * datetime util 单测（流程 M W3 — 修复 getYesterday 时区 bug）
 *
 * 关键场景：
 *   - 02:00 Asia/Dili（= UTC 17:00 前一天）跑 → periodDate 应是 Dili 视角的昨天
 *   - 跨月跨年边界（2025-12-31 / 2026-01-01）
 *   - 跨时区对比：同一 instant 在 UTC vs Asia/Dili 下 "昨天" 不同
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getYesterdayInTz,
  getDaysAgoInTz,
  isValidDateString,
  MARKET_TIMEZONE,
} from '../src/shared/datetime';

describe('shared/datetime', () => {
  beforeEach(() => {
    // 锁定时区相关 Date.now
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getYesterdayInTz', () => {
    it('返回 YYYY-MM-DD 格式', () => {
      const result = getYesterdayInTz();
      expect(isValidDateString(result)).toBe(true);
    });

    it('Asia/Dili：UTC 17:00 前一天时，返回 Dili 视角的昨天', () => {
      // 模拟 cron 触发瞬间：2026-06-26T02:00:00+09:00 = 2026-06-25T17:00:00Z
      // 此时 Dili 当地是 2026-06-26 02:00，昨天 = 2026-06-25
      // 而 UTC 视角是 2026-06-25 17:00，UTC-昨天 = 2026-06-24（错误版本会返回这个）
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-25T17:00:00Z'));

      const result = getYesterdayInTz('Asia/Dili');
      expect(result).toBe('2026-06-25'); // Dili 视角的昨天，不是 UTC 视角
    });

    it('Asia/Dili：UTC 00:00 时（Dili 09:00 当天），昨天是 Dili 当天 -1', () => {
      // 2026-06-26T00:00:00Z = 2026-06-26T09:00:00+09:00 (Dili)
      // Dili 当天 = 2026-06-26，昨天 = 2026-06-25
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-26T00:00:00Z'));

      const result = getYesterdayInTz('Asia/Dili');
      expect(result).toBe('2026-06-25');
    });

    it('跨年边界：2026-01-01 → 昨天 = 2025-12-31', () => {
      // 2026-01-01T02:00:00+09:00 = 2025-12-31T17:00:00Z
      // Dili 当天 = 2026-01-01，昨天 = 2025-12-31
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-12-31T17:00:00Z'));

      const result = getYesterdayInTz('Asia/Dili');
      expect(result).toBe('2025-12-31');
    });

    it('跨月边界：2026-03-01 → 昨天 = 2026-02-28（平年）', () => {
      // 2026-03-01T02:00:00+09:00 = 2026-02-28T17:00:00Z
      // Dili 当天 = 2026-03-01，昨天 = 2026-02-28
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-02-28T17:00:00Z'));

      const result = getYesterdayInTz('Asia/Dili');
      expect(result).toBe('2026-02-28');
    });

    it('UTC 时区：与 Date.toISOString().slice(0,10) 一致', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-25T17:00:00Z'));

      const result = getYesterdayInTz('UTC');
      // UTC 视角的昨天 = 2026-06-24
      expect(result).toBe('2026-06-24');
    });

    it('默认时区 = MARKET_TIMEZONE（Asia/Dili）', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-25T17:00:00Z'));

      const result = getYesterdayInTz();
      expect(result).toBe(getYesterdayInTz(MARKET_TIMEZONE));
    });
  });

  describe('getDaysAgoInTz', () => {
    it('N=7 一周前', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-25T17:00:00Z'));

      const result = getDaysAgoInTz(7, 'Asia/Dili');
      // Dili 当天 2026-06-26，7 天前 = 2026-06-19
      expect(result).toBe('2026-06-19');
    });

    it('N=0 今天', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-25T17:00:00Z'));

      const result = getDaysAgoInTz(0, 'Asia/Dili');
      expect(result).toBe('2026-06-26');
    });
  });

  describe('isValidDateString', () => {
    it('合法 YYYY-MM-DD', () => {
      expect(isValidDateString('2026-06-25')).toBe(true);
    });

    it('非法格式拒收', () => {
      expect(isValidDateString('2026/06/25')).toBe(false);
      expect(isValidDateString('')).toBe(false);
      expect(isValidDateString('not-a-date')).toBe(false);
    });

    it('非法日期拒收（2/30 等）', () => {
      expect(isValidDateString('2026-02-30')).toBe(false);
    });
  });
});
