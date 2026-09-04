/**
 * Prisma Decimal 适配工具：把 Prisma 运行时的 Decimal 对象归一为 number
 *
 * 背景：Prisma `@db.Decimal` 字段在运行时返回 Decimal.js 对象（带 `toNumber()`），
 * 但在部分测试/序列化路径会变成 number 或 string。直接 `Number(decimal)` 对大额
 * Decimal(12,2) 有科学计数法丢精度风险，统一走 `toNumber()` 更稳。
 *
 * 设计：单重载签名 + fallback 参数，覆盖现有全部调用模式：
 *  - `decimalToNumber(v)`          → null/undefined 返回 null
 *  - `decimalToNumber(v, fallback)` → null/undefined 返回 fallback
 *
 * 三态处理顺序：number 短路 → 有 toNumber 走 toNumber → string/bigint 走 Number() → null。
 */

/** Prisma Decimal 运行时形态（带 toNumber 的鸭子类型） */
export type PrismaDecimal = { toNumber(): number };

/** decimalToNumber 入参可接受的三态 + string（raw SQL decimal 返回 string/bigint） */
export type DecimalLike = PrismaDecimal | number | string | bigint | null | undefined;

/**
 * Decimal/number/string → number；null/undefined 返回 null（无 fallback）或 fallback。
 *
 * @param v        Prisma Decimal 对象 / number / string / null / undefined
 * @param fallback null/undefined 时的兜底值（不传则返回 null）
 * @returns number，或 null/fallback
 *
 * @example
 * decimalToNumber(warehouse.freeKm)              // Decimal → number
 * decimalToNumber(warehouse.freeKm, DEFAULT_FREE_KM) // null 兜底
 * decimalToNumber(w.centerLat)                   // NOT NULL Decimal → number
 */
export function decimalToNumber<T extends DecimalLike>(
  v: T,
): T extends null | undefined ? null : number;
export function decimalToNumber<T extends DecimalLike, D>(
  v: T,
  fallback: D,
): number | D;
export function decimalToNumber(v: DecimalLike, fallback?: unknown): unknown {
  if (v == null) {
    return fallback !== undefined ? fallback : null;
  }
  if (typeof v === 'number') {
    return v;
  }
  if (typeof v === 'object' && typeof (v as PrismaDecimal).toNumber === 'function') {
    return (v as PrismaDecimal).toNumber();
  }
  // string（raw SQL decimal 返回 string）→ Number()
  if (typeof v === 'string') {
    return Number(v);
  }
  // bigint（raw SQL COUNT(*)::bigint）→ Number()
  if (typeof v === 'bigint') {
    return Number(v);
  }
  // 兜底：未知形态，强转 number（与历史 Number(x) 行为一致）
  return Number(v as unknown as number);
}
