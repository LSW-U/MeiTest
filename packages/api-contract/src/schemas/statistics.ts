/**
 * Statistics schemas（数据分析报表模块）
 *
 * 决策依据（方案v2 §3.2 / 任务书-批B）：
 * - 金额单位：整数（分），与全契约一致（Money）
 * - 时间范围：预设 today/week/month 或自定义 from/to（YYYY-MM-DD，Dili 当地日期，含头尾）；
 *   校验由后端公共层 shared/statistics/range.ts 抛 E-STATISTICS-001/002
 * - 商品排行（R9）：OrderItem join Order（状态 ∈ GMV_ORDER_STATUSES）区间聚合，
 *   不读 salesCount（长期累计，语义不同）
 * - 错误码段：E-STATISTICS-001~099
 */
import { z } from 'zod';
import { Money, LanguageCode, ApiResponse } from './common';

/** 报表时间范围字段（预设三值 或 自定义 from/to，二选一校验由各 query 自带 refine） */
const rangeFields = {
  range: z.enum(['today', 'week', 'month']).optional(),
  /** Dili 当地日期 YYYY-MM-DD（含头尾），自定义范围时与 to 同时必填 */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
};
const rangeRequired = { message: 'range or from+to required' };

/** 报表时间范围 query：预设三值 或 自定义 from/to（二选一） */
export const StatisticsRangeQuery = z
  .object({ ...rangeFields })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsRangeQueryType = z.infer<typeof StatisticsRangeQuery>;

/** 商品排行 query：时间范围 + limit（默认 10 上限 50）+ lang（CSV 导出列名/商品名语言） */
export const StatisticsTopProductsQuery = z
  .object({
    ...rangeFields,
    limit: z.coerce.number().int().min(1).max(50).default(10),
    /** 展示语言（商品名快照取该语字段，缺语 fallback en） */
    lang: LanguageCode.default('en'),
  })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsTopProductsQueryType = z.infer<typeof StatisticsTopProductsQuery>;

/** 商品排行单行 */
export const StatisticsTopProductItem = z.object({
  productId: z.string().uuid(),
  /** 商品名（productName 快照按 lang 切片，缺语 fallback en） */
  productName: z.string(),
  productImage: z.string().nullable(),
  /** 区间内去重订单数（count distinct orderId） */
  orderCount: z.number().int().nonnegative(),
  /** 区间内销量合计 */
  quantitySold: z.number().int().nonnegative(),
  /** 区间内 GMV（Σ subtotal，分） */
  gmvAmount: Money,
});
export type StatisticsTopProductItemType = z.infer<typeof StatisticsTopProductItem>;

/** 商品排行响应 */
export const StatisticsTopProductsData = z.object({
  /** 实际生效的查询区间起止（UTC ISO，回显给前端） */
  from: z.string(),
  to: z.string(),
  items: z.array(StatisticsTopProductItem),
});
export type StatisticsTopProductsDataType = z.infer<typeof StatisticsTopProductsData>;

export const StatisticsTopProductsResponse = ApiResponse(StatisticsTopProductsData);

/** 导出 query：时间范围 + lang（列名/商品名语言，admin-web 显式传当前 locale） */
export const StatisticsExportQuery = z
  .object({
    ...rangeFields,
    lang: LanguageCode.default('en'),
  })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsExportQueryType = z.infer<typeof StatisticsExportQuery>;

// ===== 骑手绩效（批C，2026-09-10）=====

/** 骑手绩效 query：时间范围（复用公共 rangeFields + refine） */
export const StatisticsRidersQuery = z
  .object({ ...rangeFields })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsRidersQueryType = z.infer<typeof StatisticsRidersQuery>;

/**
 * 骑手绩效单行（R5 修订口径，归属源 = DeliveryTask(taskType=delivery).riderId）：
 *   - completedOrders：task 关联 Order 状态 ∈ (DELIVERED_PAID, DELIVERED, COMPLETED)
 *   - abnormalCount：task 关联 Order 状态 ∈ (CANCELLED, DELIVERED_UNPAID)
 *   - 超时未确认（PENDING_CONFIRM）不归骑手维度，不在本表
 *   - income：Settlement(subjectType=RIDER) periodDate ∈ range 各 status 均计入（分）
 *   - rating：RiderProfile.rating 快照
 */
export const StatisticsRidersResponseItem = z.object({
  riderId: z.string().uuid(),
  /** 骑手名（RiderProfile.riderName 单值字符串，非 Json i18n，无 fallback 问题） */
  riderName: z.string(),
  /** 区间内完成单数（关联 Order 三值命中） */
  completedOrders: z.number().int().nonnegative(),
  /** 区间内收入合计（Settlement netAmount 口径，分） */
  income: Money,
  /** 骑手评分快照（RiderProfile.rating，1.00-5.00） */
  rating: z.number().min(0).max(5),
  /** 区间内异常单数（关联 Order CANCELLED / DELIVERED_UNPAID） */
  abnormalCount: z.number().int().nonnegative(),
});
export type StatisticsRidersResponseItemType = z.infer<typeof StatisticsRidersResponseItem>;

/** 骑手绩效响应 */
export const StatisticsRidersData = z.object({
  /** 实际生效的查询区间起止（UTC ISO，回显给前端） */
  from: z.string(),
  to: z.string(),
  items: z.array(StatisticsRidersResponseItem),
});
export type StatisticsRidersDataType = z.infer<typeof StatisticsRidersData>;

export const StatisticsRidersResponse = ApiResponse(StatisticsRidersData);
