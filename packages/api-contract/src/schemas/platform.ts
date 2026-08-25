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

/** 列表查询参数（W4 加 ip/userAgent/traceId/resourceId 高级筛选） */
export const AuditLogQuery = z.object({
  userId: z.string().uuid().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  action: z.string().optional(),
  perspective: z.string().optional(),
  /** W4 新增：按 IP 筛选（安全审计用，比如查可疑 IP） */
  ip: z.string().optional(),
  /** W4 新增：按 User-Agent 模糊匹配 */
  userAgent: z.string().optional(),
  /** W4 新增：按 traceId 精确查找（链路追踪用） */
  traceId: z.string().optional(),
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

// ============================================================================
// SupportConfig（客服配置公开下发，P5 #1 2026-08-25）
// ============================================================================

/**
 * 客服配置视图（help 页消费，骑手/客户端通用）
 *
 * 数据源：SystemConfig key support.phone / support.hours（admin 可改，Redis cache-aside）
 * - phone：E.164-ish 客服热线，前端 `tel:` 拨号
 * - hours：客服工作时间（纯文本展示）
 */
export const SupportConfig = z.object({
  phone: z.string().min(1),
  hours: z.string(),
});
export type SupportConfigType = z.infer<typeof SupportConfig>;

export const SupportConfigResponse = ApiResponse(SupportConfig);

// ============================================================================
// LegalDocument（服务条款/隐私政策公开下发，P5 #3 2026-08-25）
// ============================================================================

/** 法律文档类型（路径参数，path：/api/v1/common/legal/{docType}） */
export const LegalDocType = z.enum(['TERMS', 'PRIVACY', 'LICENSE']);
export type LegalDocTypeType = z.infer<typeof LegalDocType>;

/**
 * 法律文档视图（按 Accept-Language 切片，单语言正文）
 *
 * 数据源：LegalDocument 表当前生效版本（is_active=true，content 多语言 JSON）
 * - content：按 lang fallback（lang → en → ""）切片后的单语言正文
 * - effectiveAt：前端展示「最近更新于」用
 */
export const LegalDocument = z.object({
  docType: LegalDocType,
  version: z.string().min(1),
  content: z.string(),
  effectiveAt: IsoTimestamp,
});
export type LegalDocumentType = z.infer<typeof LegalDocument>;

export const LegalDocumentResponse = ApiResponse(LegalDocument);

// ============================================================================
// AboutProfile（关于页可配置数据下发，P25 #2 2026-08-25）
// ============================================================================

/** 社交链接类型（前端按 type 选图标，url 直拉外部 App/浏览器） */
export const SocialLinkType = z.enum(['facebook', 'whatsapp', 'instagram']);
export type SocialLinkTypeValue = z.infer<typeof SocialLinkType>;

/** 社交链接（前端 openExternalLink 直拉，无对应 App 降级浏览器） */
export const SocialLink = z.object({
  type: SocialLinkType,
  /** 完整可拉起 URL（如 https://wa.me/67077000000），后端 host 白名单校验 */
  url: z.string().url(),
});
export type SocialLinkItem = z.infer<typeof SocialLink>;

/** 信任数据条（前端按 locale 格式化 200+/5万+，后端只返原始数字） */
export const AboutStats = z.object({
  /** 服务地区数（Warehouses 去重计数） */
  regions: z.number().int().nonnegative(),
  /** 合作商家数（Shops 计数，前端显示 "N+"） */
  merchants: z.number().int().nonnegative(),
  /** 累计订单数（Orders 计数，前端按 locale 显示 "5万+"/"50K+"） */
  orders: z.number().int().nonnegative(),
});
export type AboutStatsType = z.infer<typeof AboutStats>;

/**
 * 关于页可配置数据视图
 *
 * 数据源：
 * - stats：Prisma count（warehouses / shops / orders），Redis 缓存 TTL 1h
 * - socials：SystemConfig key `about.socials`（JSON 字符串，运营可改）
 * - mission：留前端 i18n（文案稳定，后端不返）
 */
export const AboutProfile = z.object({
  stats: AboutStats,
  socials: z.array(SocialLink),
});
export type AboutProfileType = z.infer<typeof AboutProfile>;

export const AboutProfileResponse = ApiResponse(AboutProfile);
