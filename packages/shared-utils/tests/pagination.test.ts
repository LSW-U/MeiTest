import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  clampPageSize,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from '../src/pagination';

describe('pagination', () => {
  it('encode + decode 往返一致', () => {
    const payload = { v: '2026-06-20T10:00:00Z', s: 'uuid-123' };
    const decoded = decodeCursor(encodeCursor(payload));
    expect(decoded).toEqual(payload);
  });

  it('encode: v 字段 number', () => {
    const payload = { v: 12345 };
    const decoded = decodeCursor(encodeCursor(payload));
    expect(decoded).toEqual(payload);
  });

  it('decode: 无效 base64 抛错', () => {
    expect(() => decodeCursor('!!!invalid-base64!!!')).toThrow(/INVALID_CURSOR/);
  });

  it('decode: JSON 但缺 v 字段抛错', () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf-8').toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(/INVALID_CURSOR/);
  });

  it('clampPageSize: undefined → 默认', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clampPageSize: null → 默认', () => {
    expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clampPageSize: 0 或负数 → 默认', () => {
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('clampPageSize: 超过 max → max', () => {
    expect(clampPageSize(500)).toBe(MAX_PAGE_SIZE);
  });

  it('clampPageSize: 正常值原样返回', () => {
    expect(clampPageSize(50)).toBe(50);
    expect(clampPageSize(1)).toBe(1);
  });
});
