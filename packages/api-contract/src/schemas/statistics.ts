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

// ===== 退款统计（批D，2026-09-10）=====

/** 退款统计 query：时间范围（复用公共 rangeFields + refine） */
export const StatisticsRefundsQuery = z
  .object({ ...rangeFields })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsRefundsQueryType = z.infer<typeof StatisticsRefundsQuery>;

/**
 * 退款原因分布单行（口径见 数据口径.md §2）：
 *   - 计入口径 = Refund.status ∈ (APPROVED, COMPLETED)（APPROVED 已审待打款、COMPLETED 已打款，都是"确定要退"的钱）
 *   - reason 是 TEXT 无 DB CHECK（schema.prisma 8 值是注释约定）——服务层对约定外值归 'OTHER' 展示
 */
export const StatisticsRefundReasonItem = z.object({
  /** 原因枚举原文（OUT_OF_STOCK 等 8 约定值；约定外值归 'OTHER'，不做文案映射） */
  reason: z.string(),
  /** 区间内该原因退款单数 */
  count: z.number().int().nonnegative(),
  /** 区间内该原因退款金额合计（分） */
  amount: Money,
});
export type StatisticsRefundReasonItemType = z.infer<typeof StatisticsRefundReasonItem>;

/**
 * 退款统计响应（金额单位分）：
 *   - refundCount/refundAmount：计入口径内汇总
 *   - rate：退款率 = refundCount / 同期 GMV 状态订单数（GMV_ORDER_STATUSES + createdAt ∈ range），
 *     分母为 0 时 rate = null（无同期成交则率无意义）
 *   - reasonBreakdown：groupBy reason（仅计入口径内），按 amount 降序
 */
export const StatisticsRefundsData = z.object({
  /** 实际生效的查询区间起止（UTC ISO，回显给前端） */
  from: z.string(),
  to: z.string(),
  /** 区间内退款单数（计入口径 status ∈ APPROVED/COMPLETED） */
  refundCount: z.number().int().nonnegative(),
  /** 区间内退款金额合计（分） */
  refundAmount: Money,
  /** 退款率 = refundCount / 同期 GMV 状态订单数（0-1，两位小数由前端格式化；分母 0 → null） */
  rate: z.number().min(0).max(1).nullable(),
  /** 同期 GMV 状态订单数（rate 分母回显，便于前端展示口径） */
  gmvOrderCount: z.number().int().nonnegative(),
  reasonBreakdown: z.array(StatisticsRefundReasonItem),
});
export type StatisticsRefundsDataType = z.infer<typeof StatisticsRefundsData>;

export const StatisticsRefundsResponse = ApiResponse(StatisticsRefundsData);

// ===== 客户分析（批E，2026-09-10 / 方案v2 §3.2 customers 行 · R4 MVP）=====

/** 客户分析 query：时间范围（复用公共 rangeFields + refine） */
export const StatisticsCustomersQuery = z
  .object({ ...rangeFields })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsCustomersQueryType = z.infer<typeof StatisticsCustomersQuery>;

/**
 * 客户分析响应（R4 MVP 三指标）：
 *   - newCustomers：新客 = 该用户全局首单（min(createdAt) 全表）落在区间内（非"区间内有单"）
 *   - repeatCustomers：复购 = 区间内下单 ≥2 单的用户数
 *   - repeatRate = repeatCustomers / orderUserCount（区间内下单用户数），分母 0 → null
 *   - avgOrderValue（AOV，v2 🔧 拍板）= 区间 GMV / 区间订单数（**非 ARPU**——弃用 GMV/去重用户数），
 *     分母 0 → null；金额单位分
 *   - 基数 gmvOrderCount / orderUserCount 回显（分母口径对齐批D 范式）
 */
export const StatisticsCustomersData = z.object({
  /** 实际生效的查询区间起止（UTC ISO，回显给前端） */
  from: z.string(),
  to: z.string(),
  /** 区间内新客数（全局首单落在区间内的用户数） */
  newCustomers: z.number().int().nonnegative(),
  /** 区间内复购用户数（区间内下单 ≥2 单） */
  repeatCustomers: z.number().int().nonnegative(),
  /** 复购率 = repeatCustomers / orderUserCount（0-1；分母 0 → null） */
  repeatRate: z.number().min(0).max(1).nullable(),
  /** 客单价 AOV = 区间 GMV / 区间订单数（分；非 ARPU；分母 0 → null） */
  avgOrderValue: z.number().min(0).nullable(),
  /** 区间内 GMV 状态订单数（AOV 分母回显） */
  gmvOrderCount: z.number().int().nonnegative(),
  /** 区间内下单用户数（repeatRate 分母回显） */
  orderUserCount: z.number().int().nonnegative(),
});
export type StatisticsCustomersDataType = z.infer<typeof StatisticsCustomersData>;

export const StatisticsCustomersResponse = ApiResponse(StatisticsCustomersData);

// ===== 缺货看板（缺货履约闭环批4，2026-10-24 · A5 三指标）=====

/** 缺货看板 query：时间范围（复用公共 rangeFields + refine，同批C~E 范式） */
export const StatisticsOosQuery = z
  .object({ ...rangeFields })
  .refine((q) => (q.from && q.to) || q.range, rangeRequired);
export type StatisticsOosQueryType = z.infer<typeof StatisticsOosQuery>;

/** 缺货看板单日趋势行（Dili 当地日切桶） */
export const StatisticsOosTrendItem = z.object({
  /** Dili 当地日期 YYYY-MM-DD */
  date: z.string(),
  /** 当日新登记缺货的订单数（按登记事件锚定） */
  reported: z.number().int().nonnegative(),
  /** 当日新建 OUT_OF_STOCK 退款单数 */
  oosRefunds: z.number().int().nonnegative(),
  /** 当日 system 通路退款单数（reviewedBy='SYSTEM' 全 status：含直退 COMPLETED + 超限转人工 PENDING） */
  systemRefunds: z.number().int().nonnegative(),
});
export type StatisticsOosTrendItemType = z.infer<typeof StatisticsOosTrendItem>;

/**
 * 缺货看板响应（缺货履约闭环批4 · A5，口径 = 模块收尾文档 §三指标口径）：
 *   - 登记率 = reportedOrderCount / fulfilledOrderCount
 *     （履约订单 = Order.status ∈ GMV_ORDER_STATUSES 或全缺取消单 [status='CANCELLED' 且
 *      cancelReason='OUT_OF_STOCK']（批4 审查 P2-1 方案1：保证分子⊆分母、率恒≤1），
 *      且 createdAt ∈ range；
 *      有缺货登记 = 订单任一 OrderItem.outOfStockQty 非空，锚点 Order.createdAt ∈ range）
 *   - 自动退款率 = systemRefundCount / oosRefundCount
 *     （OUT_OF_STOCK 退款 = Refund.reason='OUT_OF_STOCK' 且 createdAt ∈ range，全 status 计入；
 *      system = reviewedBy='SYSTEM'）
 *   - 人工介入率 = pendingCount / oosRefundCount
 *     （pending = status='PENDING' 的 OUT_OF_STOCK 退款——含超限转人工 D17，可观测指标）
 *   - 分母 0 → 对应 rate = null（同批D/E 范式）
 *   - 规则表变更追溯：不落本响应——走 AuditLog(resourceType='OutOfStockRule') + OOS_RULE_UPDATED 日志
 */
export const StatisticsOosData = z.object({
  /** 实际生效的查询区间起止（UTC ISO，回显给前端） */
  from: z.string(),
  to: z.string(),
  /** 区间内履约订单数（GMV 状态集 + 全缺取消单，登记率分母，批4 P2-1 口径） */
  fulfilledOrderCount: z.number().int().nonnegative(),
  /** 区间内有缺货登记的订单数（任一 OrderItem.outOfStockQty 非空） */
  reportedOrderCount: z.number().int().nonnegative(),
  /** 登记率 = reportedOrderCount / fulfilledOrderCount（0-1；分母 0 → null） */
  reportRate: z.number().min(0).max(1).nullable(),
  /** 区间内 OUT_OF_STOCK 退款单数（全 status，自动退款率/人工介入率分母） */
  oosRefundCount: z.number().int().nonnegative(),
  /** 区间内 system 退款单数（reviewedBy='SYSTEM'） */
  systemRefundCount: z.number().int().nonnegative(),
  /** 自动退款率 = systemRefundCount / oosRefundCount（0-1；分母 0 → null） */
  autoRefundRate: z.number().min(0).max(1).nullable(),
  /** 区间内 PENDING 人工队列 OUT_OF_STOCK 退款单数（含超限转人工 D17） */
  pendingCount: z.number().int().nonnegative(),
  /** 人工介入率 = pendingCount / oosRefundCount（0-1；分母 0 → null） */
  manualInterventionRate: z.number().min(0).max(1).nullable(),
  /** 按日趋势（Dili 当地日切桶，日期升序） */
  trend: z.array(StatisticsOosTrendItem),
});
export type StatisticsOosDataType = z.infer<typeof StatisticsOosData>;

export const StatisticsOosResponse = ApiResponse(StatisticsOosData);
