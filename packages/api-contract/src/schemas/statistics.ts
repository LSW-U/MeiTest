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
