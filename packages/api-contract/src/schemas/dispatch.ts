/**
 * 配送调度模块 schema
 *
 * 决策依据：
 * - schema.prisma 已有 DeliveryTask + CashCollection
 * - W2 仅 W3 才完整接入，本 schema 提供 W3-W5 用的视图
 *
 * W3 任务：抢单大厅 + 系统派单 + 骑手取货送达
 */
import { z } from 'zod';
import { Id, Money, IsoTimestamp, PaginatedResponse } from './common';

/** 配送任务状态（与 schema.prisma DeliveryTaskStatus 同步） */
export const DeliveryTaskStatus = z.enum([
  'PENDING_ASSIGN', // 待派送（系统未派或骑手未抢）
  'ASSIGNED', // 已分配给骑手
  'PICKED_UP', // 骑手已取货
  'DELIVERING', // 配送中
  'DELIVERED', // 已送达
  'FAILED', // 配送失败（异常上报）
]);

/** 配送任务（1:1 订单） */
export const DeliveryTask = z.object({
  id: Id,
  orderId: Id,
  riderId: Id.nullable(),
  warehouseId: Id,
  status: DeliveryTaskStatus,
  /** P14 ④：任务类型（delivery 配送 / return 退货取件，默认 delivery 向后兼容） */
  taskType: z.enum(['delivery', 'return']).default('delivery'),
  /** P14 ④：return 任务关联的 refund（仅 taskType=return 时填；delivery 为 null） */
  refundId: Id.nullable(),
  pickupAddress: z.string(),
  pickupLat: z.number(),
  pickupLng: z.number(),
  dropoffAddress: z.string(),
  dropoffLat: z.number(),
  dropoffLng: z.number(),
  assignedAt: IsoTimestamp.nullable(),
  pickedUpAt: IsoTimestamp.nullable(),
  deliveredAt: IsoTimestamp.nullable(),
  note: z.string().nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** T6 联系拨号：客户电话（从 order.deliveryAddress.phone 透传，历史订单可能无 → 可选） */
  contactPhone: z.string().optional(),
});

// Why: taskId 走 URL path param（:id），body 不重复携带。
// 4 个 dispatch action 的 body 都不含 taskId；controller 用 @Param('id') 读取。
// 修复历史契约 bug：原 schema 要求 body.taskId 但 controller 不读，前端发 {note} 被 400。

/** 抢单请求（骑手 App 调）— 无 body，taskId 走 URL */
export const AcceptTaskRequest = z.object({});

/** 骑手上报取货 */
export const PickupTaskRequest = z.object({
  note: z.string().max(200).optional(),
});

/** 骑手上报送达 */
export const DeliverTaskRequest = z.object({
  /** COD 场景下：实收金额（小于应付金额时标 SHORT，等于/大于标 PAID） */
  collectedAmount: Money.optional(),
  note: z.string().max(200).optional(),
});

/** 异常上报 */
export const ReportIssueRequest = z.object({
  reason: z.enum([
    'CUSTOMER_UNREACHABLE',
    'CUSTOMER_REJECTED',
    'ADDRESS_NOT_FOUND',
    'TRAFFIC_ACCIDENT',
    'OTHER',
  ]),
  note: z.string().max(500).optional(),
});

/**
 * P14 ④：骑手开始配送（PICKED_UP -> DELIVERING）
 *
 * 决策 1 选 A（2026-08-11）：return 任务三步 PICKED_UP->DELIVERING->DELIVERED（本端点负责第一步）；
 * delivery 任务保持两步 PICKED_UP->DELIVERED（跳过 DELIVERING，走 deliver）。
 * 本端点仅 taskType=return 可调，打通原 DELIVERING 死状态。
 */
export const StartDeliveringRequest = z.object({
  note: z.string().max(200).optional(),
});

// ============================================================================
// Admin 视角（批次 4：admin dispatch 看板）
// ============================================================================

/** admin 任务列表查询（游标分页 + filter） */
export const ListAllTasksQuery = z.object({
  status: DeliveryTaskStatus.optional(),
  warehouseId: Id.optional(),
  riderId: Id.optional(),
  orderNo: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** admin 视角骑手摘要（改派/详情用） */
export const TaskRiderSummary = z.object({
  id: Id,
  riderName: z.string(),
  phone: z.string(),
});

/** admin 视角订单摘要（详情用） */
export const TaskOrderSummary = z.object({
  orderNo: z.string(),
  status: z.string(),
  payableAmount: Money.nullable(),
  paymentMethod: z.string(),
});

/** admin 视角任务（含 order + rider + warehouseCode + ETA） */
export const AdminDeliveryTaskView = DeliveryTask.extend({
  estimatedArrival: IsoTimestamp.nullable(),
  warehouseCode: z.string(),
  order: TaskOrderSummary,
  rider: TaskRiderSummary.nullable(),
});

/** admin 任务列表响应（游标分页） */
export const AdminTaskListResponse = PaginatedResponse(AdminDeliveryTaskView);

/** 改派请求（第一期只支持 ASSIGNED 状态） */
export const ReassignTaskRequest = z.object({
  newRiderId: Id,
  reason: z.string().max(500).optional(),
});

/** 取消请求（PENDING_ASSIGN / ASSIGNED） */
export const CancelTaskRequest = z.object({
  reason: z.string().max(500).optional(),
});

/** 可派骑手（APPROVED + Redis 在线标记） */
export const AvailableRider = z.object({
  id: Id,
  riderName: z.string(),
  phone: z.string(),
  vehicleType: z.enum(['BICYCLE', 'MOTORCYCLE', 'CAR']),
  isOnline: z.boolean(),
  totalDeliveries: z.number().int(),
  rating: z.number(),
});
