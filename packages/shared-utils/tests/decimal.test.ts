import { describe, it, expect } from 'vitest';
import { decimalToNumber } from '../src/decimal';

/** 模拟 Prisma Decimal 运行时对象（鸭子类型 toNumber） */
const dec = (n: number) => ({ toNumber: () => n });

describe('decimalToNumber（批次4 P3-1：Prisma Decimal 归一 helper）', () => {
  it('Decimal 对象走 toNumber', () => {
    expect(decimalToNumber(dec(3.14))).toBe(3.14);
    expect(decimalToNumber(dec(0))).toBe(0);
  });

  it('number 短路直返（测试/序列化路径的形态）', () => {
    expect(decimalToNumber(2.5)).toBe(2.5);
  });

  it('string（raw SQL decimal）→ Number()', () => {
    expect(decimalToNumber('12.34')).toBe(12.34);
    expect(decimalToNumber('0')).toBe(0);
  });

  it('bigint（raw SQL COUNT::bigint）→ Number()', () => {
    expect(decimalToNumber(123n)).toBe(123);
  });

  it('null/undefined 无 fallback → null', () => {
    expect(decimalToNumber(null)).toBeNull();
    expect(decimalToNumber(undefined)).toBeNull();
    expect(decimalToNumber(dec(1) as never)).not.toBeNull();
  });

  it('null/undefined 带 fallback → fallback（各站点兜底语义）', () => {
    expect(decimalToNumber(null, 5)).toBe(5); // rider rating 兜底 5
    expect(decimalToNumber(undefined, 0)).toBe(0); // dispatch 坐标兜底 0
    expect(decimalToNumber(null, 2)).toBe(2); // pricing freeKm 兜底 DEFAULT_FREE_KM
  });

  it('fallback=undefined 显式传时返回 null（不与「未传」混淆也归 null）', () => {
    expect(decimalToNumber(null, undefined)).toBeNull();
  });

  it('类型重载：非空入参返回 number', () => {
    const v: number = decimalToNumber(dec(9) as never);
    expect(v).toBe(9);
  });
});
