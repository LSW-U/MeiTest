/**
 * Platform / Audit / SystemConfig schemas
 *
 * 流程 M（治理/财务）独占契约。
 *
 * 决策依据：
 * - 金额单位：契约 v0.2 §1.3 — 整数（分），不用 float
 * - GMV：MVP 测试阶段用 Order.payableAmount 估算（payment 数据 W5 切真）
 * - AuditLog：复用 W1 已有 model（schema.prisma L595），不重复定义
 * - 错误码段：E-PLATFORM-* / E-AUDIT-*（W2-COLLABORATION.md §3.4）
 */
import { z } from 'zod';
import { Money, IsoTimestamp, I18nText, ApiResponse, PaginatedResponse } from './common';

// ============================================================================
// Dashboard
// ============================================================================

/** 时间范围（聚合粒度由后端决定） */
export const DashboardTimeRange = z.enum(['today', 'week', 'month']);
export type DashboardTimeRangeType = z.infer<typeof DashboardTimeRange>;

/** 单点趋势（GMV / 订单数按日/时聚合） */
export const TrendPoint = z.object({
  /** ISO 8601 date 或 datetime，按 range 决定粒度（today→hour, week/month→day） */
  bucket: z.string(),
  gmv: Money,
  orderCount: z.number().int().nonnegative(),
});
export type TrendPointType = z.infer<typeof TrendPoint>;

/** 仓库维度钻取 */
export const WarehouseBreakdownItem = z.object({
  warehouseId: z.string().uuid(),
  /** 多语言仓库名称，前端按 Accept-Language 取 */
  warehouseName: I18nText,
  gmv: Money,
  orderCount: z.number().int().nonnegative(),
  /** 异常订单数（超时/退款） */
  abnormalCount: z.number().int().nonnegative(),
});
export type WarehouseBreakdownItemType = z.infer<typeof WarehouseBreakdownItem>;

/** Dashboard 汇总数据 */
export const DashboardSummary = z.object({
  range: DashboardTimeRange,
  /** 起止时间（UTC ISO） */
  from: IsoTimestamp,
  to: IsoTimestamp,
  gmv: Money,
  /** GMV 同比上周期（百分比，-100~+∞） */
  gmvGrowthPct: z.number(),
  orderCount: z.number().int().nonnegative(),
  orderCountGrowthPct: z.number(),
  /** 当前在线骑手数（实时） */
  onlineRiderCount: z.number().int().nonnegative(),
  /** 异常订单（超时未确认/退款中） */
  abnormalOrderCount: z.number().int().nonnegative(),
  /** GMV / 订单数趋势（按 range 粒度聚合） */
  trend: z.array(TrendPoint),
  /** 仓库维度钻取（前 N + 其他） */
  warehouseBreakdown: z.array(WarehouseBreakdownItem),
});
export type DashboardSummaryType = z.infer<typeof DashboardSummary>;

export const DashboardSummaryResponse = ApiResponse(DashboardSummary);

// ============================================================================
// AuditLog（复用 W1 AuditLog 表）
// ============================================================================

export const AuditLogListItem = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  deviceType: z.enum(['CLIENT_APP', 'RIDER_APP', 'ADMIN_WEB']).nullable(),
  perspective: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: IsoTimestamp,
});
export type AuditLogListItemType = z.infer<typeof AuditLogListItem>;

export const AuditLogDetail = AuditLogListItem.extend({
  beforeData: z.unknown().nullable(),
  afterData: z.unknown().nullable(),
  userAgent: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type AuditLogDetailType = z.infer<typeof AuditLogDetail>;

/** 列表查询参数 */
export const AuditLogQuery = z.object({
  userId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  action: z.string().optional(),
  perspective: z.string().optional(),
  from: IsoTimestamp.optional(),
  to: IsoTimestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type AuditLogQueryType = z.infer<typeof AuditLogQuery>;

export const AuditLogListResponse = PaginatedResponse(AuditLogListItem);
export const AuditLogDetailResponse = ApiResponse(AuditLogDetail);

// ============================================================================
// SystemConfig（key-value 配置 + Redis 缓存）
// ============================================================================

export const SystemConfigItem = z.object({
  key: z.string().min(1).max(128),
  value: z.string(),
  description: z.string().nullable(),
  updatedAt: IsoTimestamp,
  updatedBy: z.string().uuid().nullable(),
});
export type SystemConfigItemType = z.infer<typeof SystemConfigItem>;

export const SystemConfigListResponse = ApiResponse(z.array(SystemConfigItem));

export const UpdateSystemConfigRequest = z.object({
  value: z.string().min(1),
  description: z.string().optional(),
});
export type UpdateSystemConfigRequestType = z.infer<typeof UpdateSystemConfigRequest>;

export const SystemConfigResponse = ApiResponse(SystemConfigItem);
