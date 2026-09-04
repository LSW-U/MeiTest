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

/**
 * 每日营业时间（按周几配置）
 *
 * 结构约定（Warehouse 模块完善批 B，与 seed.ts/批 C 周表一致）：
 * - open/close: 'HH:mm' 或 ''（空 = 休息日）；rest: true = 休息日
 * - 非休息日（open/close 均非空且 rest 非 true）要求 close > open（不支持跨天，已知限制）
 */
export const OperatingHours = z.record(
  z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  z.object({
    open: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
    close: z.string().regex(/^\d{2}:\d{2}$/).or(z.literal('')),
    rest: z.boolean().optional(),
  }),
);

/**
 * 仓库列表库存聚合（批 B，方案 S1）
 *
 * 口径（双口径已定稿）：
 * - skuCount：该仓 SKU 数
 * - totalQuantity：全部 SKU quantity 之和（含 0）
 * - sellableQuantity：仅 quantity>0 的 quantity 之和
 */
export const StockSummary = z.object({
  skuCount: z.number().int().nonnegative(),
  totalQuantity: z.number().int().nonnegative(),
  sellableQuantity: z.number().int().nonnegative(),
});

/**
 * 仓库详情在编人员（批 B，方案 S2 / Codex 设计 §1.3）
 *
 * roles 取 user.role 单值数组（现有 Role 枚举名，如 'WAREHOUSE_STAFF'）；前端展示取 roles[0]。
 * name 为 User.name（plain string，可空）。
 */
export const WarehouseStaffItem = z.object({
  id: Id,
  userId: Id,
  name: z.string().nullable(),
  roles: z.array(z.string()),
});

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
  // 批 B 透出：perKmFee 分/km、freeKm km（pricing.calcDeliveryFee 已在用，见 UpdatePricingConfigRequest）
  perKmFee: Money.default(0),
  freeKm: z.number().default(2),
  // 列表/详情均返回；空仓 0/0/0
  stockSummary: StockSummary.optional(),
  isActive: z.boolean().default(true),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** 仓库详情响应（GET /:id：实体 + 在编人员；create/update 不返回 staffList） */
export const WarehouseDetailResponse = Warehouse.extend({
  staffList: z.array(WarehouseStaffItem),
});

/** 创建/修改仓库请求 */
const UpsertWarehouseBase = z.object({
  code: z.string().regex(/^W\d{2}$/).optional(),
  name: I18nText,
  coverageArea: GeoJsonPolygon.nullable(),
  centerLat: z.number(),
  centerLng: z.number(),
  address: z.string(),
  operatingHours: OperatingHours.nullable(),
  deliveryFee: Money,
  // 批 B：可选，create 缺省 0/2（与 schema 默认一致）；update 未传不动。
  // freeKm 上限 999km（远超东帝汶国土，防 1e999→Infinity 穿透进 Prisma Decimal；批 B 审查 P3-2）
  perKmFee: Money.optional(),
  freeKm: z.number().nonnegative().max(999).optional(),
  isActive: z.boolean(),
});

// zod v3 z.record(枚举键) 缺日不拒（runtime 只校验出现的键），故 7 天齐全走 refine
const OPERATING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * operatingHours 语义校验（批 B，P2-1 修复后 create/update 两个请求 schema 共用）：
 * 1. operatingHours 非 null/undefined 时 7 天齐全（缺日拒；zod v3 record 枚举键不强制齐全）
 * 2. 休息日约定：rest:true 或 open/close 同空 = 休息日；半空日（一空一非空）拒（P3-1，
 *    避免「未设置但 rest=false」的矛盾态入库）
 * 3. 非休息日 close > open（不支持跨天，已知限制）
 */
const operatingHoursComplete = (data: { operatingHours?: Record<string, unknown> | null }) =>
  !data.operatingHours || OPERATING_DAYS.every((d) => d in data.operatingHours!);

const operatingHoursSemantic = (data: {
  operatingHours?: Record<string, { open: string; close: string; rest?: boolean }> | null;
}) => {
  if (!data.operatingHours) return true;
  return Object.values(data.operatingHours).every((day) => {
    if (day.rest === true) return true;
    const hasOpen = !!day.open;
    const hasClose = !!day.close;
    if (hasOpen !== hasClose) return false; // 半空日拒
    if (hasOpen && day.close <= day.open) return false; // 不支持跨天
    return true;
  });
};

const OPERATING_REFINE_OPTIONS = [
  { message: 'operatingHours: all 7 days (mon..sun) are required' },
  { message: 'operatingHours: close must be later than open on non-rest days (no cross-midnight); a day is a rest day only if rest=true or open/close are both empty' },
] as const;

/** 创建仓库请求（全必填；operatingHours 可为 null = 未设置） */
export const UpsertWarehouseRequest = UpsertWarehouseBase
  .refine(operatingHoursComplete, OPERATING_REFINE_OPTIONS[0])
  .refine(operatingHoursSemantic, OPERATING_REFINE_OPTIONS[1]);

/**
 * 更新仓库请求（批 B 审查 P2-1，用户拍板选 a）：全可选 partial，PATCH 部分更新只动传入字段。
 * operatingHours 语义校验与 create 同源（仅当传入时校验）。
 */
export const UpdateWarehouseRequest = UpsertWarehouseBase.partial()
  .refine(operatingHoursComplete, OPERATING_REFINE_OPTIONS[0])
  .refine(operatingHoursSemantic, OPERATING_REFINE_OPTIONS[1]);

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
  // freeKm 上限 999km 与 UpsertWarehouseBase 对齐（批 B 审查 P3-2：防 Infinity 穿透）
  freeKm: z.number().nonnegative().max(999).optional(),
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
