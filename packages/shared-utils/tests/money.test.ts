import { describe, it, expect } from 'vitest';
import {
  yuanToCents,
  centsToYuan,
  addMoney,
  subtractMoney,
  multiplyMoney,
  formatMoney,
} from '../src/money';

describe('money', () => {
  it('yuanToCents: 9.99 → 999', () => {
    expect(yuanToCents(9.99)).toBe(999);
  });

  it('整数分实现避免浮点精度（0.1 + 0.2 = 0.30000000000000004 浮点问题）', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const tenCents = yuanToCents(0.1);
    const twentyCents = yuanToCents(0.2);
    expect(addMoney(tenCents, twentyCents)).toBe(30);
    expect(centsToYuan(30)).toBe(0.3);
  });

  it('centsToYuan: 999 → 9.99', () => {
    expect(centsToYuan(999)).toBe(9.99);
  });

  it('addMoney: 100 + 200 = 300', () => {
    expect(addMoney(100, 200)).toBe(300);
  });

  it('addMoney: 多参数求和', () => {
    expect(addMoney(100, 200, 300, 400)).toBe(1000);
  });

  it('addMoney: 无参数 → 0', () => {
    expect(addMoney()).toBe(0);
  });

  it('subtractMoney: 500 - 200 = 300', () => {
    expect(subtractMoney(500, 200)).toBe(300);
  });

  it('subtractMoney: 负数结果抛错', () => {
    expect(() => subtractMoney(100, 200)).toThrow(/MONEY_NEGATIVE/);
  });

  it('multiplyMoney: 999 * 2 = 1998', () => {
    expect(multiplyMoney(999, 2)).toBe(1998);
  });

  it('multiplyMoney: 浮点因子四舍五入', () => {
    expect(multiplyMoney(100, 0.85)).toBe(85);
    expect(multiplyMoney(99, 0.5)).toBe(50); // 49.5 → 50
  });

  it('formatMoney: USD 格式', () => {
    expect(formatMoney(999)).toBe('$9.99');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(100)).toBe('$1.00');
  });
});
