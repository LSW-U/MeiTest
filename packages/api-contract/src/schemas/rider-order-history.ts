/**
 * Rider order history schemas（骑手端订单历史端点，方案v2-20261009）
 *
 * 口径（R12 拍板 20261009，三态互斥 + 优先级）：
 *   - cancelled：关联 Order CANCELLED（优先，即使 task 本身 DELIVERED/FAILED）
 *   - transferred：task FAILED 且订单未取消
 *   - completed：task DELIVERED 且订单未取消
 *   - all = completed + cancelled + transferred（三者之和，tab 徽标不双计）
 *
 * 字段源（§2.1 表）：
 *   - income = order.deliveryFee（分，Q2 拍板「配送费收入」；Settlement 按日聚合无 orderId 不可按单对账）
 *   - completedAt = deliveredAt（completed）/ updatedAt（cancelled/transferred），epoch ms
 *   - dropoffName = order.deliveryAddress.name（AddressSnapshot={name,phone,detail,lat,lng}，无 contactName）
 *   - pickupName = warehouse.name.en（admin-deposit.service.ts:497 先例）→ 缺失回退 code
 *   - durationMinutes = pickedUpAt→deliveredAt 差值，缺失给 0
 *   - distanceKm = pickup→dropoff Haversine（toView 同款，坐标缺失回退计费距离，再缺失给 0）
 *
 * 历史数据注记：当前库 99 FAILED 任务全部关联 CANCELLED 订单 → 派生后全进 cancelled，
 * transferred 预期 0（验收 A3 注明属预期非 bug）。
 */
import { z } from 'zod';
import { Id, Money, ApiResponse, OffsetPaginatedResponse } from './common';

/** 历史订单派生状态（三态互斥，R12 口径；不透传 DeliveryTaskStatus 原始枚举） */
export const RiderOrderHistoryStatus = z.enum(['completed', 'cancelled', 'transferred']);
export type RiderOrderHistoryStatusType = z.infer<typeof RiderOrderHistoryStatus>;

/** 历史订单条目（列表项 = 详情单对象，§2.4「响应同 §2.1 单对象」） */
export const RiderOrderHistoryItem = z.object({
  /** delivery task id（详情路由参数复用） */
  id: Id,
  orderNo: z.string(),
  status: RiderOrderHistoryStatus,
  /** epoch ms（completed=deliveredAt；cancelled/transferred=updatedAt） */
  completedAt: z.number().int().nonnegative(),
  /** 仓库代码（前端无 name 时以 pickupAddress 兜底展示） */
  pickupName: z.string(),
  pickupAddress: z.string(),
  /** 收货人姓名（order.deliveryAddress.name，历史快照可能缺 → ''） */
  dropoffName: z.string(),
  dropoffAddress: z.string(),
  /** 配送费收入（分，Q2 口径 = order.deliveryFee） */
  income: Money,
  /** 骑行距离 km（Haversine 优先，回退计费距离，缺失 0） */
  distanceKm: z.number().nonnegative(),
  /** 取货→送达分钟数，缺失给 0（前端 >0 判断降级「—」） */
  durationMinutes: z.number().int().nonnegative(),
});
export type RiderOrderHistoryItemType = z.infer<typeof RiderOrderHistoryItem>;

/** 状态计数（R12 互斥：all = completed + cancelled + transferred） */
export const RiderOrderHistoryStatusCounts = z.object({
  all: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  transferred: z.number().int().nonnegative(),
});
export type RiderOrderHistoryStatusCountsType = z.infer<typeof RiderOrderHistoryStatusCounts>;

/** 详情响应（§2.1 单对象） */
export const RiderOrderHistoryDetailResponse = ApiResponse(RiderOrderHistoryItem);

/** 状态计数响应 */
export const RiderOrderHistoryStatusCountsResponse = ApiResponse(RiderOrderHistoryStatusCounts);

// ============================================================================
// 批1（P1）：history 列表 + today 统计（与批2 共用上方 Item/Status 派生口径）
// ============================================================================

/** Guarded coerce（rider-earnings.ts:51 先例：@Query 恒 string；仅纯数字串转换） */
function coerceInt(input: unknown): unknown {
  if (typeof input === 'string' && /^\d+$/.test(input)) return Number(input);
  return input;
}

/** 历史列表查询：offset 分页（rider-earnings 先例）+ 三态可选过滤（R12 口径，过滤在派生映射后做） */
export const RiderOrderHistoryQuery = z.object({
  page: z.preprocess(coerceInt, z.number().int().positive().default(1)),
  pageSize: z.preprocess(coerceInt, z.number().int().positive().max(100).default(20)),
  status: RiderOrderHistoryStatus.optional(),
});
export type RiderOrderHistoryQueryType = z.infer<typeof RiderOrderHistoryQuery>;

/** 列表响应（offset 分页：page/pageSize/total，rider-earnings 先例） */
export const RiderOrderHistoryListResponse = OffsetPaginatedResponse(RiderOrderHistoryItem);

/** 今日统计（profile 页「今日订单/收入」+ history 页底栏；count 与 totalIncome 同口径只算 completed） */
export const RiderOrderTodayStats = z.object({
  /** 今日 completed 任务数（Dili 当日，R12 口径） */
  count: z.number().int().nonnegative(),
  /** 今日配送费收入合计（分，= Σ order.deliveryFee，与 count 同口径只算 completed） */
  totalIncome: Money,
});
export type RiderOrderTodayStatsType = z.infer<typeof RiderOrderTodayStats>;

export const RiderOrderTodayStatsResponse = ApiResponse(RiderOrderTodayStats);
