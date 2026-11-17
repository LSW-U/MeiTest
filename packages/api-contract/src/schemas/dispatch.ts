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
  /** 取证照片 URL 数组（≤3 张，pickup/deliver/report-issue 时落库；批2 后端依赖专项 2026-10-01） */
  evidenceUrls: z.array(z.string().url()).default([]),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** 关联业务订单号（MMxxx；骑手到店报单号展示用，20261115 契约补声明——toView 早已透传） */
  orderNo: z.string().optional(),
  /**
   * 关联订单状态（F3 已取消订单出口 20261117 立项 B2）。
   * 骑手端据此在 CANCELLED 订单卡渲染「订单已取消」badge +「上报异常」入口
   * （reportIssue reason=ORDER_CANCELLED）。旧数据/契约滞后 → undefined，
   * 前端防御性可选，badge 不渲染。
   */
  orderStatus: z.enum([
    'PENDING_PAYMENT',
    'PENDING_CONFIRM',
    'CONFIRMED',
    'PICKED',
    'OUT_FOR_DELIVERY',
    'DELIVERED_PAID',
    'DELIVERED',
    'DELIVERED_UNPAID',
    'COMPLETED',
    'CANCELLED',
  ]).optional(),
  /**
   * 预约单开门时间（ISO，即时单 null；骑手大厅卡片-后端配合需求① 20261115）。
   * 语义 = 预约开门时间，不是送达 deadline。前端已备「预约单」badge 防御性 UI。
   */
  scheduledFor: IsoTimestamp.nullable().optional(),
  /**
   * 送达 deadline 锚点（ISO，需求②/⑤B 20261115）。
   * 来源 delivery_tasks.estimated_arrival（建单时刻 + 45min 静态值，接单不刷新——
   * 已知瑕疵记录不阻塞，实时 ETA 另立项）。缺失 → 前端降级分钟口径文案。
   */
  estimatedArrival: IsoTimestamp.nullable().optional(),
  /** T6 联系拨号：客户电话（从 order.deliveryAddress.phone 透传，历史订单可能无 → 可选） */
  contactPhone: z.string().optional(),
  /** 仓库名多语言包（en/id/pt/zh/tet，来自 warehouses.name jsonb；前端按 locale 自取，缺失/旧数据 → null） */
  pickupTitleI18n: z.record(z.string()).nullable().optional(),
  /** 收件人姓名（从 order.deliveryAddress.name 透传；历史订单可能无 → 可选） */
  dropoffContactName: z.string().optional(),
  /**
   * 配送费（分，P0-1 修复 2026-08-25）
   * 从 order.deliveryFee 透传；骑手卡片展示真实配送费。历史订单可能无 → 可选。
   */
  deliveryFee: z.number().int().nonnegative().optional(),
  /**
   * 配送费基础费（分，距离计费批次1 2026-08-27）
   * 从 order.delivery_fee_breakdown.baseFee 透传（订单快照）。
   * breakdown 缺失（历史单/无坐标）→ undefined，前端只显总额。
   */
  baseFee: z.number().int().nonnegative().optional(),
  /**
   * 配送费距离加价（分，距离计费批次1 2026-08-27）
   * 从 order.delivery_fee_breakdown.distanceFee 透传（订单快照）。
   * 与 baseFee 一起展示明细「基础 $X + 距离 $Y = $Z」。
   */
  distanceFee: z.number().int().nonnegative().optional(),
  /**
   * 计费距离（km，距离计费批次1 2026-08-27 / P2-2 审查报告修复）
   * 从 order.delivery_fee_breakdown.distanceKm 透传 = PostGIS ST_DistanceSphere(仓库中心→收货地址)。
   * 与 distanceKm（pickup→dropoff haversine 骑行距离）语义不同：本字段是距离费的计算基准。
   * breakdown 缺失（历史单/无坐标）→ undefined。
   */
  billingDistanceKm: z.number().nonnegative().optional(),
  /**
   * 配送直线距离（km，P6 #7 2026-08-25）
   * pickup → dropoff 的 Haversine 距离；任一坐标缺失 → undefined（前端降级隐藏）。
   * 非实时路况距离，仅作展示/排序参考。
   */
  distanceKm: z.number().nonnegative().optional(),
  /**
   * 预估配送时长（分钟，P6 #7 2026-08-25）
   * 由 distanceKm ÷ 20km/h 推导，上限 45 分钟兜底（不做实时路况）。
   * distanceKm 缺失 → undefined（前端降级到 etaPlaceholder）。
   */
  estimatedMinutes: z.number().int().nonnegative().optional(),
  /**
   * 商品摘要（骑手大厅卡片-后端配合需求 20261115）。
   * totalQty = Σ OrderItem.quantity（总件数）；kinds = 去重 SKU 数。
   * order.items 未 include → undefined（前端降级隐藏）。对齐行业惯例：接单决策看件数不看明细，不带商品图片。
   */
  itemsSummary: z
    .object({
      totalQty: z.number().int().nonnegative(),
      kinds: z.number().int().nonnegative(),
    })
    .optional(),
  /**
   * 动态 ETA（ISO 时刻，实时动态 ETA 方案 C 2026-11-17，读时计算自骑手最新位置）。
   * 位置不新鲜（>2min）/键缺失/Redis 异常/非进行中任务 → null，
   * 前端回退静态死线 estimatedArrival（降级链保留）。字段仅 /rider/dispatch/my-tasks
   * 进行中任务实时计算；大厅（PENDING_ASSIGN）无归属骑手恒 null。
   */
  liveEta: z.string().nullable().optional(),
});

// Why: taskId 走 URL path param（:id），body 不重复携带。
// 4 个 dispatch action 的 body 都不含 taskId；controller 用 @Param('id') 读取。
// 修复历史契约 bug：原 schema 要求 body.taskId 但 controller 不读，前端发 {note} 被 400。

/** 抢单请求（骑手 App 调）— 无 body，taskId 走 URL */
export const AcceptTaskRequest = z.object({});

/** 骑手上报取货 */
export const PickupTaskRequest = z.object({
  note: z.string().max(200).optional(),
  /** 取证照片 URL（先传 POST /api/v1/common/rider/uploads/task-evidence 获取；≤3 张） */
  evidenceUrls: z.array(z.string().url()).max(3).optional(),
});

/** 骑手上报送达 */
export const DeliverTaskRequest = z.object({
  /** COD 场景下：实收金额（小于应付金额时标 SHORT，等于/大于标 PAID） */
  collectedAmount: Money.optional(),
  note: z.string().max(200).optional(),
  /** 取证照片 URL（先传 POST /api/v1/common/rider/uploads/task-evidence 获取；≤3 张） */
  evidenceUrls: z.array(z.string().url()).max(3).optional(),
});

/** 异常上报 */
export const ReportIssueRequest = z.object({
  reason: z.enum([
    'CUSTOMER_UNREACHABLE',
    'CUSTOMER_REJECTED',
    'ADDRESS_NOT_FOUND',
    'TRAFFIC_ACCIDENT',
    // F3 已取消订单出口（20261117 立项 D1 拍板）：订单已取消、货在骑手手上的返仓上报
    'ORDER_CANCELLED',
    // §4 死线超时出口（同 D1）：普通单送达死线超时，骑手返仓上报
    'DEADLINE_OVERDUE_RETURN',
    'OTHER',
  ]),
  note: z.string().max(500).optional(),
  /** 取证照片 URL（先传 POST /api/v1/common/rider/uploads/task-evidence 获取；≤3 张） */
  evidenceUrls: z.array(z.string().url()).max(3).optional(),
});

/**
 * P14 ④：骑手开始配送（PICKED_UP -> DELIVERING）
 *
 * 20261116 拍板：所有任务类型统一三步 PICKED_UP->DELIVERING->DELIVERED（本端点负责第一步）；
 * 原「仅 taskType=return 可调」限制（E-DISPATCH-020）已移除。
 * 事务内：deliveryTask.update(DELIVERING) + refund.update(pickedAt)（return 任务）。
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

/** admin 视角任务（含 order + rider + warehouseCode；estimatedArrival 20261115 上移至基类 DeliveryTask——骑手/管理员共用同一锚点字段） */
export const AdminDeliveryTaskView = DeliveryTask.extend({
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

/** Admin 直接指派请求（批 F，2026-09-03，批E审查 P0-1）：PENDING_ASSIGN → 指定骑手 */
export const AssignTaskRequest = z.object({
  riderId: Id,
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
