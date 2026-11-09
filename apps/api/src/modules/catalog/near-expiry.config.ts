/**
 * 临期标注 Config — P3体验增强 批1（方案v2 D1d，2026-11-09）
 *
 * 阈值 = catalog 模块内 config 常量（拍板弃 SystemConfig 表通道——单阈值
 * 不值得配置表 + admin UI + 缓存失效链路；要调时改常量发版）。
 *
 * 口径（方案v2 D1b/D1c）：
 * - 已过天数 = Product.createdAt 近似（录入时间非上架/生产时间，接受偏差并明示风险：
 *   长期不轮换的商品会逐渐误入临期态；后续可加 listingDate 列根治，挂账）
 * - 派生单点在 catalog.service（列表/详情组装链），client 只读 isNearExpiry 不自行计算
 */

/** 临期阈值（天）：剩余保质期 ≤ 该天数即标「临期」 */
export const NEAR_EXPIRY_THRESHOLD_DAYS = 3;

/**
 * 派生临期字段（D1c 单点 helper）
 *
 * @param shelfLifeDays 保质期天数（null/undefined=未录入，不标）
 * @param createdAt     商品创建时间（D1b 近似锚点）
 * @param now           当前时间（默认 Date.now()，测试注入）
 * @param thresholdDays 临期阈值（默认 NEAR_EXPIRY_THRESHOLD_DAYS）
 * @returns daysToExpiry：剩余天数（向下取整，可为负=已过期；未录入为 null）
 *          isNearExpiry：0 ≤ 剩余 ≤ 阈值（已过期不标——过期是另一语义，MVP 不做）
 */
export function deriveNearExpiry(
  shelfLifeDays: number | null | undefined,
  createdAt: Date,
  now: Date = new Date(),
  thresholdDays: number = NEAR_EXPIRY_THRESHOLD_DAYS,
): { daysToExpiry: number | null; isNearExpiry: boolean } {
  if (shelfLifeDays == null) return { daysToExpiry: null, isNearExpiry: false };
  const elapsedDays = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
  const daysToExpiry = shelfLifeDays - elapsedDays;
  return { daysToExpiry, isNearExpiry: daysToExpiry >= 0 && daysToExpiry <= thresholdDays };
}
