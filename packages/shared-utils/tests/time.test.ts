import { describe, it, expect } from 'vitest';
import {
  DILI_TIMEZONE,
  nowUtcIso,
  diliDateYyyyMMdd,
  diliDateYyyyMmDd,
  formatInDili,
} from '../src/time';

describe('time', () => {
  it('DILI_TIMEZONE = Asia/Dili', () => {
    expect(DILI_TIMEZONE).toBe('Asia/Dili');
  });

  it('nowUtcIso 返回 ISO 字符串', () => {
    const iso = nowUtcIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(iso.endsWith('Z')).toBe(true);
  });

  it('diliDateYyyyMMdd: 2026-06-20 00:30 UTC → 20260620 (UTC+9 是 09:30)', () => {
    expect(diliDateYyyyMMdd(new Date('2026-06-20T00:30:00.000Z'))).toBe('20260620');
  });

  it('diliDateYyyyMMdd: 2026-06-20 14:30 UTC → 20260620 (UTC+9 是 23:30)', () => {
    expect(diliDateYyyyMMdd(new Date('2026-06-20T14:30:00.000Z'))).toBe('20260620');
  });

  it('diliDateYyyyMMdd: 跨日 2026-06-20 15:30 UTC → 20260621 (UTC+9 是次日 00:30)', () => {
    expect(diliDateYyyyMMdd(new Date('2026-06-20T15:30:00.000Z'))).toBe('20260621');
  });

  it('diliDateYyyyMmDd: 格式正确', () => {
    expect(diliDateYyyyMmDd(new Date('2026-06-20T10:00:00.000Z'))).toBe('2026-06-20');
  });

  it('formatInDili: 时间在东帝汶时区', () => {
    const formatted = formatInDili(new Date('2026-06-20T00:00:00.000Z').toISOString(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    // UTC 00:00 → Dili 09:00
    expect(formatted).toBe('09:00');
  });

  it('formatInDili: 默认格式', () => {
    const formatted = formatInDili(new Date('2026-06-20T10:00:00.000Z').toISOString());
    expect(formatted).toContain('2026');
  });
});
