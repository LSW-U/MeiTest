import { describe, it, expect } from 'vitest';
import { genId, genIdV4, isValidUuid } from '../src/id';

describe('id', () => {
  it('genId 返回 UUID v7（version nibble = 7）', () => {
    const id = genId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(id[14]).toBe('7');
  });

  it('genId 时序友好（前 48 位是毫秒时间戳）', () => {
    const before = Date.now();
    const id = genId();
    const after = Date.now();
    // 前 12 字符（48 位）= 毫秒时间戳
    const ts = parseInt(id.slice(0, 13).replace(/-/g, '').slice(0, 12), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('genIdV4 返回 v4（version nibble = 4）', () => {
    const id = genIdV4();
    expect(id[14]).toBe('4');
  });

  it('genId/genIdV4 唯一性', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(genId());
    }
    expect(ids.size).toBe(1000);
  });

  it('isValidUuid: 有效 UUID', () => {
    expect(isValidUuid(genId())).toBe(true);
    expect(isValidUuid(genIdV4())).toBe(true);
    expect(isValidUuid('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
  });

  it('isValidUuid: 无效字符串', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('')).toBe(false);
    expect(isValidUuid('12345')).toBe(false);
  });
});
