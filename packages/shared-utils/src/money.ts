/**
 * 金额工具：单位为整数分（USD cents），避免浮点精度问题
 *
 * 决策依据：契约 v0.2 §1.3 — 金额统一整数（分），不用 float
 */

/** 金额类型：整数分（USD cents） */
export type Money = number;

/** 元 → 分（四舍五入，处理 0.1+0.2 浮点问题） */
export function yuanToCents(yuan: number): Money {
  return Math.round(yuan * 100);
}

/** 分 → 元 */
export function centsToYuan(cents: Money): number {
  return cents / 100;
}

/** 金额加法（整数分实现，避免浮点精度问题） */
export function addMoney(...amounts: Money[]): Money {
  return amounts.reduce((acc, n) => acc + n, 0);
}

/** 金额减法（结果非负，否则抛错） */
export function subtractMoney(a: Money, b: Money): Money {
  const result = a - b;
  if (result < 0) {
    throw new Error(`MONEY_NEGATIVE: ${a} - ${b} = ${result}`);
  }
  return result;
}

/** 金额乘数量（四舍五入到分） */
export function multiplyMoney(amount: Money, factor: number): Money {
  return Math.round(amount * factor);
}

/** 用 Intl 格式化 USD 货币 */
export function formatMoney(cents: Money, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}
