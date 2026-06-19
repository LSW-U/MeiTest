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
