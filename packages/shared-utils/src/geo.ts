/**
 * 地理距离工具：Haversine 公式 + ETA 推导
 *
 * 决策依据：
 * - CLAUDE.md：东帝汶市场（赤道附近 -8°S），欧氏近似误差 < 1%，但 Haversine 是无副作用的精确实现，
 *   配送任务距离/ETA 需要稳定可解释，统一用 Haversine（避免与 pricing.service 的欧氏近似混淆）。
 * - 不依赖地图 API（东帝汶地图数据差 + API 配额风险，见 dispatch.config.ts）。
 * - estimatedMinutes：距离 ÷ 平均时速推导，无实时路况；DEFAULT_ETA_MINUTES 作上限兜底。
 */

/** 地球赤道半径（km） */
const EARTH_RADIUS_KM = 6371;

/** 度 → 弧度 */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine 球面距离（km）
 *
 * 公式：2 * R * asin(sqrt(sin²(dLat/2) + cos(lat1)*cos(lat2)*sin²(dLng/2)))
 * 任一坐标缺失 / 非有限 → 返回 null（调用方自行降级）
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number | null {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return null;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * 按平均时速推导预估分钟数
 *
 * @param distanceKm    距离（km）
 * @param avgSpeedKmh   平均时速（默认 20km/h，东帝汶城市骑手经验值）
 * @param maxMinutes    上限兜底（默认 45 分钟，对齐 dispatch.config DEFAULT_ETA_MINUTES）
 * @returns 预估分钟数；distanceKm 非法 → null
 *
 * 推导值上限 maxMinutes，避免长距离场景 ETA 失真（MVP 不做实时路况）。
 */
export function estimateMinutesFromDistance(
  distanceKm: number,
  avgSpeedKmh = 20,
  maxMinutes = 45,
): number | null {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
  const raw = (distanceKm / avgSpeedKmh) * 60;
  return Math.min(Math.round(raw), maxMinutes);
}
