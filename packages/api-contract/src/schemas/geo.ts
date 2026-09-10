/**
 * Geo 模块 schema（地址 → 经纬度 geocoding）
 *
 * 决策依据：
 * - 后端要求 P0-3：客户端保存地址时后端补 lat/lng，避免前端依赖 Google Maps SDK
 * - 方案 A：后端调 Nominatim OpenStreetMap（免费，无 key），失败 fallback 东帝汶 Dili
 *
 * 响应 source 字段：
 *   - 'nominatim': Nominatim 真实查询结果
 *   - 'fallback': 调用失败 / 无结果 → Dili 中心坐标（-8.5567, 125.5595）
 */
import { z } from 'zod';

/** 纬度范围 [-90, 90] */
export const Latitude = z.number().min(-90).max(90);

/** 经度范围 [-180, 180] */
export const Longitude = z.number().min(-180).max(180);

/** Geocode 请求 query */
export const GeocodeRequest = z.object({
  address: z.string().min(2, 'ADDRESS_TOO_SHORT').max(500, 'ADDRESS_TOO_LONG'),
});

/** Geocode 响应 data */
export const GeocodeResponseData = z.object({
  lat: Latitude,
  lng: Longitude,
  /** 来源标识（前端可展示"已定位"/"默认位置"提示） */
  source: z.enum(['nominatim', 'fallback']),
  /** Nominatim 返回的完整地址（fallback 时为 null） */
  formattedAddress: z.string().nullable(),
});

/** Nominatim 单条结果（仅服务端用，不暴露给前端） */
export const NominatimResult = z.object({
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
});

// ===== 保证金批A A7（2026-09-10）：suggest 多候选 + nearby 附近地点 =====

/** Suggest 请求 query（地址输入联想） */
export const GeoSuggestRequest = z.object({
  q: z.string().min(2, 'ADDRESS_TOO_SHORT').max(500, 'ADDRESS_TOO_LONG'),
});

/** Suggest 单条候选（与 client-app GeoHit 同形态） */
export const GeoSuggestHit = z.object({
  lat: Latitude,
  lng: Longitude,
  /** Nominatim display_name（完整地址文本） */
  label: z.string(),
});

/** Suggest 响应 data */
export const GeoSuggestResponseData = z.object({
  items: z.array(GeoSuggestHit),
});

/** Nearby 请求 query（坐标 2km 内带名称地点）
 *
 * 批D 审查 P1-1（2026-09-11）：Express @Query 恒为 string（axios params 序列化进 URL），
 * z.number() 直接 parse 必 400 E-COMMON-001 → real 模式 nearby 全死。
 * 先 preprocess 拒 null/undefined/空串，再 coerce 转数字校验范围——裸 z.coerce.number()
 * 会把 null/'' 转成 0 混过校验（坐标 0 点在几内亚湾，非东帝汶），必须挡住。
 * suggest 的 q / geocode 的 address 本身就是 string，无同类问题。
 */
const QueryCoordinate = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === null || v === undefined || v === '' ? undefined : v),
    z.coerce.number().min(min).max(max),
  );

export const GeoNearbyRequest = z.object({
  lat: QueryCoordinate(-90, 90),
  lng: QueryCoordinate(-180, 180),
});

/** Nearby 单条结果（与 client-app NearbyPlaceResult 同形态） */
export const GeoNearbyPlace = z.object({
  /** OSM 节点 id（`osm-` 前缀） */
  id: z.string(),
  name: z.string(),
  /** 距查询坐标的直线距离（米，Haversine 取整） */
  distanceM: z.number().int().min(0),
  lat: Latitude,
  lng: Longitude,
});

/** Nearby 响应 data（按距离升序，前 5 条） */
export const GeoNearbyResponseData = z.object({
  items: z.array(GeoNearbyPlace),
});
