/**
 * 仓库模块 schema（含 PostGIS GeoJSON Polygon）
 *
 * 决策依据：
 * - 业务决策 2：多仓库（5-10 个），PostGIS 匹配最近仓库
 * - 契约 v0.3 冲突 5：新增 Warehouse 模型，coverageArea 用 PostGIS Polygon
 * - CLAUDE.md §多语言：name 用 i18n JSON
 * - CLAUDE.md §JWT：warehouseId 取后 2 位作 orderNo warehouseId 段，code 用 W01-W10
 *
 * GeoJSON 坐标约定：[lng, lat]，外层是数组套数组套数组（Polygon 多边形）
 */
import { z } from 'zod';
import { Id, I18nText, Money } from './common';

/** GeoJSON Polygon（PostGIS coverage_area 对应类型） */
export const GeoJsonPolygon = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

/** GeoJSON Point（PostGIS center_point 对应类型） */
export const GeoJsonPoint = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
});

/** 每日营业时间（按周几配置） */
export const OperatingHours = z.record(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/),
    close: z.string().regex(/^\d{2}:\d{2}$/),
  }),
);

/** 仓库实体（5-10 个，按地理位置划分） */
export const Warehouse = z.object({
  id: Id,
  code: z.string().regex(/^W\d{2}$/, 'WAREHOUSE_CODE_FORMAT: W01-W10'),
  name: I18nText,
  coverageArea: GeoJsonPolygon.nullable(),
  centerPoint: GeoJsonPoint.nullable(),
  centerLat: z.number().nullable(),
  centerLng: z.number().nullable(),
  address: z.string(),
  operatingHours: OperatingHours.nullable(),
  deliveryFee: Money.default(0),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** 创建/修改仓库请求 */
export const UpsertWarehouseRequest = z.object({
  code: z.string().regex(/^W\d{2}$/).optional(),
  name: I18nText,
  coverageArea: GeoJsonPolygon.nullable(),
  centerLat: z.number(),
  centerLng: z.number(),
  address: z.string(),
  operatingHours: OperatingHours.nullable(),
  deliveryFee: Money,
  isActive: z.boolean(),
});

/** 按经纬度匹配最近仓库请求 */
export const MatchWarehouseRequest = z.object({
  lat: z.number(),
  lng: z.number(),
});

/**
 * 配送费灰度配置请求（批次3 2026-08-28）
 *
 * 三字段全可选 partial —— 未传字段不动，便于灰度切换（如仅调 perKmFee=50）。
 * baseFee/perKmFee 分单位整数 ≥0；freeKm km ≥0（允许 0 = 无起步免费距离）。
 * 至少传一个字段（refine 拦截空对象 → 400，与 controller 内联版同源约束）。
 *
 * 注：zod-to-openapi 不把 .refine() 翻译成 openapi minProperties，故 openapi 文档
 * 不显式编码「至少一字段」约束，但源码两侧一致便于维护，400 描述亦已说明。
 */
export const UpdatePricingConfigRequest = z.object({
  baseFee: Money.optional(),
  perKmFee: Money.optional(),
  freeKm: z.number().nonnegative().optional(),
}).refine(
  (data) =>
    data.baseFee !== undefined ||
    data.perKmFee !== undefined ||
    data.freeKm !== undefined,
  {
    message: 'At least one of baseFee / perKmFee / freeKm must be provided',
  },
);

/**
 * 配送费配置响应（批次3 2026-08-28）
 *
 * /config 与 /base-fee 200 响应体——service.updatePricingConfig 返回值。
 * freeKm 已在 service 层 .toNumber() 归一为 number（Decimal→number）。
 */
export const PricingConfigResponse = z.object({
  warehouseId: Id,
  baseFee: Money,
  perKmFee: Money,
  freeKm: z.number(),
});
