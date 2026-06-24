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
import { Id, Money, IsoTimestamp } from './common';

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
});

/** 抢单请求（骑手 App 调） */
export const AcceptTaskRequest = z.object({
  taskId: Id,
});

/** 骑手上报取货 */
export const PickupTaskRequest = z.object({
  taskId: Id,
  note: z.string().max(200).optional(),
});

/** 骑手上报送达 */
export const DeliverTaskRequest = z.object({
  taskId: Id,
  /** COD 场景下：实收金额（小于应付金额时标 SHORT，等于/大于标 PAID） */
  collectedAmount: Money.optional(),
  note: z.string().max(200).optional(),
});

/** 异常上报 */
export const ReportIssueRequest = z.object({
  taskId: Id,
  reason: z.enum([
    'CUSTOMER_UNREACHABLE',
    'CUSTOMER_REJECTED',
    'ADDRESS_NOT_FOUND',
    'TRAFFIC_ACCIDENT',
    'OTHER',
  ]),
  note: z.string().max(500).optional(),
});
