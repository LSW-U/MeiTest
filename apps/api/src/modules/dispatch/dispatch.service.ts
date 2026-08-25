/**
 * Dispatch Service — 配送调度核心
 *
 * 决策依据：
 * - 契约 v0.3：DeliveryTask 与 Order 1:1，订单 CONFIRMED 后自动建任务
 * - W-M-C-T 任务分解 W3 M2 C1/C2/C3：抢单大厅 + 按仓分组 + 系统派单
 *
 * 抢单防并发（乐观锁，无 SELECT FOR UPDATE）：
 *   UPDATE delivery_tasks
 *   SET status='ASSIGNED', rider_id=?, assigned_at=now()
 *   WHERE id=? AND status='PENDING_ASSIGN'
 *   RETURNING id;
 *
 *   返回 0 行 → 任务已被其他骑手抢 / 已被系统派走 / 已取消 → 抛 E-DISPATCH-002
 *
 * WS 广播（新订单抢单大厅）：
 *   - OrderService 在订单 CONFIRMED 时调 createTaskForOrder
 *   - server.to('riders').emit('dispatch:new-task', { taskId, warehouseId, ... })
 *   - 骑手 App 收到后刷新抢单大厅
 */
import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction } from '../../shared/db';
import type { Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEFAULT_ETA_MINUTES } from './dispatch.config';
import { haversineDistanceKm, estimateMinutesFromDistance } from '@meimart/shared-utils';
import { redis } from '../../shared/cache';
import { POINTS_PER_DELIVERY, calcTier } from '../rider/rider.service';

/** DeliveryTask 列表项视图 */
export interface DeliveryTaskView {
  id: string;
  orderId: string;
  riderId: string | null;
  warehouseId: string;
  status: 'PENDING_ASSIGN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERING' | 'DELIVERED' | 'FAILED';
  /** P14 ④：任务类型（delivery 配送 / return 退货取件） */
  taskType: 'delivery' | 'return';
  /** P14 ④：return 任务关联的 refund（delivery 为 null） */
  refundId: string | null;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** 关联订单号（前端展示用） */
  orderNo?: string;
  /** 仓库代码（前端筛选用） */
  warehouseCode?: string;
  /** W7 补字段：订单应付金额（骑手 COD 收款参考） */
  payableAmount?: number;
  /** COD 判断依据（'COD' 时骑手端 sign 页要求输入实收金额） */
  paymentMethod?: string;
  /** W7 补字段：配送费 */
  deliveryFee?: number;
  /** W7 补字段：订单项摘要（如"牛奶 x1, 鸡蛋 x2"） */
  itemsSummary?: string;
  /** T6 联系拨号：客户电话（从 order.deliveryAddress.phone 取，历史订单可能无 → 可选） */
  contactPhone?: string;
  /**
   * 配送直线距离（km，P6 #7 2026-08-25）
   * pickup → dropoff 的 Haversine 距离；任一坐标缺失 → undefined（前端降级隐藏）。
   * 非实时路况距离，仅作展示/排序参考。
   */
  distanceKm?: number;
  /**
   * 预估配送时长（分钟，P6 #7 2026-08-25）
   * 由 distanceKm ÷ 20km/h 推导，上限 DEFAULT_ETA_MINUTES(45) 兜底；
   * distanceKm 缺失 → undefined（前端降级到 etaPlaceholder）。
   */
  estimatedMinutes?: number;
}

/** 抢单上下文 */
export interface AcceptTaskInput {
  riderId: string;
  taskId: string;
}

/** 上报取货 */
export interface PickupTaskInput {
  riderId: string;
  taskId: string;
  note?: string;
}

/** 上报送达 */
export interface DeliverTaskInput {
  riderId: string;
  taskId: string;
  /** COD 场景：实收金额（分），与应付对比决定 PAID/SHORT/UNPAID */
  collectedAmount?: number;
  note?: string;
}

/** 异常上报 */
export interface ReportIssueInput {
  riderId: string;
  taskId: string;
  reason: 'CUSTOMER_UNREACHABLE' | 'CUSTOMER_REJECTED' | 'ADDRESS_NOT_FOUND' | 'TRAFFIC_ACCIDENT' | 'OTHER';
  note?: string;
}

/**
 * P14 ④：开始配送（PICKED_UP → DELIVERING）
 *
 * 决策 1 选 A（2026-08-11）：return 任务三步 PICKED_UP->DELIVERING->DELIVERED（本方法负责第一步）；
 * delivery 任务保持两步 PICKED_UP->DELIVERED（跳过 DELIVERING，走 deliverTask）。
 * 本方法仅 taskType=return 可调，打通原 DELIVERING 死状态。
 */
export interface StartDeliveringInput {
  riderId: string;
  taskId: string;
  note?: string;
}

/** P14 ④：建 return 任务的入参（refundId 单参数，内含 full relation 查询） */
export interface CreateReturnTaskInput {
  refundId: string;
}

// ============================================================================
// Admin 视角（批次 4：admin dispatch 看板）
// ============================================================================

/** admin 任务列表查询输入 */
export interface ListAllTasksInput {
  status?: 'PENDING_ASSIGN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERING' | 'DELIVERED' | 'FAILED';
  warehouseId?: string;
  riderId?: string;
  orderNo?: string;
  cursor?: string;
  limit?: number;
}

/** admin 视角任务（含 order + rider 关联） */
export interface AdminDeliveryTaskView {
  id: string;
  orderId: string;
  riderId: string | null;
  warehouseId: string;
  status: 'PENDING_ASSIGN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERING' | 'DELIVERED' | 'FAILED';
  /** P14 ④：任务类型（delivery / return），admin 看板区分显示 */
  taskType: 'delivery' | 'return';
  /** P14 ④：return 任务关联的 refund（delivery 为 null） */
  refundId: string | null;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  estimatedArrival: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  warehouseCode: string;
  order: { orderNo: string; status: string; payableAmount: number | null; paymentMethod: string };
  rider: { id: string; riderName: string; phone: string } | null;
}

/** 可派骑手（APPROVED + Redis 在线标记） */
export interface AvailableRider {
  id: string;
  riderName: string;
  phone: string;
  vehicleType: 'BICYCLE' | 'MOTORCYCLE' | 'CAR';
  isOnline: boolean;
  totalDeliveries: number;
  rating: number;
}

@Injectable()
export class DispatchService {
  constructor(
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * 查询抢单大厅（待派送订单池）
   */
  async listPendingTasks(options: {
    riderId: string;
    warehouseId?: string;
    limit?: number;
  }): Promise<{ items: DeliveryTaskView[] }> {
    const limit = Math.min(options.limit ?? 50, 100);

    const tasks = await db.deliveryTask.findMany({
      where: {
        status: 'PENDING_ASSIGN',
        ...(options.warehouseId ? { warehouseId: options.warehouseId } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: {
        // P0-1 修复：补 deliveryFee，骑手卡片才能显示真实配送费（原 5 处 select 漏选 → toView 恒 undefined）
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });

    return {
      items: tasks.map((t) => this.toView(t)),
    };
  }

  /**
   * 查询我的任务（当前骑手已接单/取货/配送中）
   *
   * Why: 前端 tasks 页 pickups/deliveries tab 需要骑手自己的任务，
   *   listPendingTasks 只返回 PENDING_ASSIGN（抢单大厅）无法覆盖。
   *   riderId 为 User.id（JWT sub），需 resolveRiderProfileId 转 RiderProfile.id 与 rider_id 字段对齐。
   */
  async listMyTasks(options: { riderId: string }): Promise<{ items: DeliveryTaskView[] }> {
    const riderId = await this.resolveRiderProfileId(options.riderId);
    const tasks = await db.deliveryTask.findMany({
      where: {
        riderId,
        status: { in: ['ASSIGNED', 'PICKED_UP', 'DELIVERING'] },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });
    return { items: tasks.map((t) => this.toView(t)) };
  }

  /**
   * 抢单（乐观锁防重复抢）
   *
   * S2 修复：UPDATE delivery_tasks + UPDATE order.riderId 同事务，避免进程崩溃后状态分裂
   */
  async acceptTask(input: AcceptTaskInput): Promise<DeliveryTaskView> {
    // riderId 实际是 User.id（JWT sub），delivery_tasks.rider_id 引用 RiderProfile.id
    const riderId = await this.resolveRiderProfileId(input.riderId);
    const now = new Date();

    // 先查 orderId（用于事务内的 order.update）
    const taskBefore = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      select: { orderId: true, status: true },
    });
    if (!taskBefore) {
      throw new NotFoundException({
        code: 'E-DISPATCH-001',
        message: 'Task not found',
      });
    }

    if (taskBefore.status !== 'PENDING_ASSIGN') {
      throw new ConflictException({
        code: 'E-DISPATCH-002',
        message: `Task already ${taskBefore.status} (cannot be grabbed)`,
      });
    }

    // 事务：乐观锁 UPDATE + order.riderId 同步（任一失败回滚）
    const updateResult = await withTransaction(async (tx: Tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "delivery_tasks"
        SET status = 'ASSIGNED',
            rider_id = ${riderId},
            assigned_at = ${now},
            updated_at = ${now}
        WHERE id = ${input.taskId}
          AND status = 'PENDING_ASSIGN'
      `;
      if (updated === 0) {
        return { ok: false as const };
      }
      await tx.order.update({
        where: { id: taskBefore.orderId },
        data: { riderId: riderId },
      });
      return { ok: true as const };
    });

    if (!updateResult.ok) {
      // 并发场景：刚查到 PENDING_ASSIGN 但 UPDATE 时已被改 → 视为已被抢
      const existing = await db.deliveryTask.findUnique({ where: { id: input.taskId } });
      throw new ConflictException({
        code: 'E-DISPATCH-002',
        message: `Task already ${existing?.status ?? 'unknown'} (cannot be grabbed)`,
      });
    }

    // 事务外查 task 详情用于响应 + WS 推送
    const task = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });

    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found after accept' });
    }

    logger.info({
      msg: 'DISPATCH_TASK_ACCEPTED',
      taskId: input.taskId,
      riderId: riderId,
      orderId: task.orderId,
    });

    // WS 推送：通知其他骑手该任务已被抢（前端从大厅移除）
    try {
      this.realtime.server.to('riders').emit('dispatch:task-accepted', {
        taskId: input.taskId,
        riderId: riderId,
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_ACCEPTED_FAILED',
        taskId: input.taskId,
        error: (e as Error).message,
      });
    }

    return this.toView(task);
  }

  /** 上报取货（ASSIGNED → PICKED_UP） */
  async pickupTask(input: PickupTaskInput): Promise<DeliveryTaskView> {
    const riderId = await this.resolveRiderProfileId(input.riderId);
    const task = await db.deliveryTask.findUnique({ where: { id: input.taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (task.riderId !== riderId) {
      throw new ConflictException({
        code: 'E-DISPATCH-003',
        message: 'Task not assigned to this rider',
      });
    }
    if (task.status !== 'ASSIGNED') {
      throw new ConflictException({
        code: 'E-DISPATCH-004',
        message: `Task status ${task.status} cannot be picked up`,
      });
    }

    // P14 ④：走 withTransaction，taskType=return 时事务内额外写 refund.pickupAt
    const { updated } = await withTransaction(async (tx: Tx) => {
      const t = await tx.deliveryTask.update({
        where: { id: input.taskId },
        data: {
          status: 'PICKED_UP',
          pickedUpAt: new Date(),
          note: input.note ?? task.note,
        },
        include: {
          // P0-1 修复：补 deliveryFee
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
          warehouse: { select: { code: true } },
        },
      });

      // 同步 Order 状态机：CONFIRMED → PICKED
      await tx.order.update({
        where: { id: task.orderId },
        data: { status: 'PICKED', pickedAt: new Date() },
      });

      // P14 ④：return 任务写 refund.pickupAt（前端 P14 时间轴 pickupArranging 步骤展示）
      if (task.taskType === 'return' && task.refundId) {
        await tx.refund.update({
          where: { id: task.refundId },
          data: { pickupAt: new Date() },
        });
      }

      return { updated: t };
    });

    try {
      this.realtime.server.to(`order:${task.orderId}`).emit('order:status', {
        orderId: task.orderId,
        status: 'PICKED',
        taskId: input.taskId,
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_PICKUP_FAILED',
        taskId: input.taskId,
        error: (e as Error).message,
      });
    }

    return this.toView(updated);
  }

  /**
   * 上报送达（PICKED_UP → DELIVERED + Order 状态机推进）
   *
   * COD 场景：
   *   - collectedAmount = payableAmount → PAID + DELIVERED_PAID
   *   - collectedAmount < payableAmount → SHORT + DELIVERED_PAID（标 partial）
   *   - collectedAmount = 0（拒付）→ UNPAID + DELIVERED_UNPAID
   * 预付场景：collectedAmount 留空 → DELIVERED
   */
  async deliverTask(input: DeliverTaskInput): Promise<DeliveryTaskView> {
    const riderId = await this.resolveRiderProfileId(input.riderId);
    const task = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      include: { order: true },
    });
    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (task.riderId !== riderId) {
      throw new ConflictException({
        code: 'E-DISPATCH-003',
        message: 'Task not assigned to this rider',
      });
    }
    if (task.status !== 'PICKED_UP' && task.status !== 'DELIVERING') {
      throw new ConflictException({
        code: 'E-DISPATCH-004',
        message: `Task status ${task.status} cannot be delivered`,
      });
    }

    // F1 修复（2026-08-24 审查报告）：return 任务送达走独立分支，不复用 delivery 状态机推进
    //   - return 任务（退货回仓）送达：只推进 deliveryTask → DELIVERED，不碰 Order（订单已是 CANCELLED）、
    //     不建 CashCollection（退货不收款）、不计积分（delivery 才计）
    //   - 历史问题：原 deliverTask 对 taskType 无前置断言，return 任务走 DELIVERING 第三步会被 deliverTask 接管，
    //     把退款单 Order.status 倒退回 DELIVERED_* 并写入虚假 cashCollection
    if (task.taskType === 'return') {
      const updated = await db.deliveryTask.update({
        where: { id: input.taskId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          note: input.note ?? task.note,
        },
        include: {
          // P0-1 修复：补 deliveryFee
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
          warehouse: { select: { code: true } },
        },
      });
      logger.info({
        msg: 'DISPATCH_RETURN_TASK_DELIVERED',
        taskId: input.taskId,
        orderId: task.orderId,
        refundId: task.refundId,
      });
      return this.toView(updated);
    }

    // delivery 任务送达：推进 Order 状态机 + COD 收款 + 计积分

    const order = task.order;
    const isCod = order.paymentMethod === 'COD';

    let cashResult: 'PAID' | 'SHORT' | 'UNPAID' | null = null;
    if (isCod) {
      if (input.collectedAmount === undefined || input.collectedAmount === 0) {
        cashResult = 'UNPAID';
      } else if (input.collectedAmount < order.payableAmount) {
        cashResult = 'SHORT';
      } else {
        cashResult = 'PAID';
      }
    }

    const nextOrderStatus: 'DELIVERED' | 'DELIVERED_PAID' | 'DELIVERED_UNPAID' =
      !isCod
        ? 'DELIVERED'
        : cashResult === 'PAID' || cashResult === 'SHORT'
          ? 'DELIVERED_PAID'
          : 'DELIVERED_UNPAID';

    // P1-2 修复：deliverTask 多步操作包进事务（task.update + order.update + cashCollection.create）
    const { updated } = await withTransaction(async (tx: Tx) => {
      const t = await tx.deliveryTask.update({
        where: { id: input.taskId },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          note: input.note ?? task.note,
        },
        include: {
          // P0-1 修复：补 deliveryFee
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
          warehouse: { select: { code: true } },
        },
      });

      await tx.order.update({
        where: { id: task.orderId },
        data: { status: nextOrderStatus, deliveredAt: new Date() },
      });

      if (isCod && input.collectedAmount !== undefined) {
        await tx.cashCollection.create({
          data: {
            orderId: task.orderId,
            riderId: riderId,
            collectedAmount: input.collectedAmount,
            result: cashResult ?? 'UNPAID',
            note: input.note,
          },
          select: { id: true },
        });
      }

      // W3 骑手积分：delivery 任务送达 +1 单 +10 分 + 同步 tier（F5/F6 2026-08-24 审查报告）
      //   - 事务内 increment points，并按新 points 同步写 tier（calcTier 纯派生量，写时算准）
      //   - 这样 getProfile/updateProfile 只读 tier 不再需要回写兜底，消除查询路径写放大 + 两条端点 tier 不一致
      await tx.riderProfile.update({
        where: { id: riderId },
        data: {
          totalDeliveries: { increment: 1 },
          points: { increment: POINTS_PER_DELIVERY },
          // Prisma 不支持 increment 后在同一 UPDATE 用结果算 tier，先读后算再写：
          // 此处用子查询式 SQL 太重，退而求其次：increment points 后单独再 update tier。
          // 为保证单事务一致性，下面显式查一次再写（事务内可见刚 increment 的值）。
        },
      });
      // 事务内重读 points 算 tier 并写回（calcTier 是 points 纯派生量）
      const reloaded = await tx.riderProfile.findUnique({
        where: { id: riderId },
        select: { points: true },
      });
      if (reloaded) {
        await tx.riderProfile.update({
          where: { id: riderId },
          data: { tier: calcTier(reloaded.points) },
        });
      }
      return { updated: t };
    });

    logger.info({
      msg: 'DISPATCH_TASK_DELIVERED',
      taskId: input.taskId,
      orderId: task.orderId,
      isCod,
      cashResult,
    });

    try {
      this.realtime.server.to(`order:${task.orderId}`).emit('order:status', {
        orderId: task.orderId,
        status: nextOrderStatus,
        taskId: input.taskId,
        cashResult,
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_DELIVER_FAILED',
        taskId: input.taskId,
        error: (e as Error).message,
      });
    }

    return this.toView(updated);
  }

  /**
   * P14 ④：开始配送（PICKED_UP -> DELIVERING）
   *
   * 决策 1 选 A（2026-08-11）：return 任务三步 PICKED_UP->DELIVERING->DELIVERED（本方法负责第一步）；
   * delivery 任务保持两步 PICKED_UP->DELIVERED（跳过 DELIVERING，走 deliverTask）。
   * 本方法仅 taskType=return 可调，打通原 DELIVERING 死状态（enum 有值无写入点）。
   *
   * 事务内：deliveryTask.update(DELIVERING) + refund.update(pickedAt)（return 任务）
   */
  async startDelivering(input: StartDeliveringInput): Promise<DeliveryTaskView> {
    const riderId = await this.resolveRiderProfileId(input.riderId);
    const task = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (task.riderId !== riderId) {
      throw new ConflictException({
        code: 'E-DISPATCH-003',
        message: 'Task not assigned to this rider',
      });
    }
    // P14 ④：仅 return 任务可调（delivery 走 deliverTask 跳过 DELIVERING）
    if (task.taskType !== 'return') {
      throw new ConflictException({
        code: 'E-DISPATCH-020',
        message: `Task ${input.taskId} invalid taskType ${task.taskType} (startDelivering only for return task)`,
      });
    }
    if (task.status !== 'PICKED_UP') {
      throw new ConflictException({
        code: 'E-DISPATCH-004',
        message: `Task status ${task.status} cannot start delivering`,
      });
    }

    // 事务内：deliveryTask.update(DELIVERING) + refund.update(pickedAt)
    const { updated } = await withTransaction(async (tx: Tx) => {
      const t = await tx.deliveryTask.update({
        where: { id: input.taskId },
        data: {
          status: 'DELIVERING',
          note: input.note ?? task.note,
        },
        include: {
          // P0-1 修复：补 deliveryFee
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
          warehouse: { select: { code: true } },
        },
      });

      // P14 ④：return 任务写 refund.pickedAt（前端 P14 时间轴 picked 步骤展示）
      if (task.refundId) {
        await tx.refund.update({
          where: { id: task.refundId },
          data: { pickedAt: new Date() },
        });
      }

      return { updated: t };
    });

    logger.info({
      msg: 'DISPATCH_TASK_DELIVERING',
      taskId: input.taskId,
      riderId,
      orderId: task.orderId,
      refundId: task.refundId,
    });

    return this.toView(updated);
  }

  /**
   * 异常上报（标记 task FAILED + 写 OrderEvent + WS 推客服）
   *
   * V2-S1 修复：deliveryTask.update + orderEvent.create 包事务
   * V2-S2 修复：加状态前置校验（仅 ASSIGNED/PICKED_UP/DELIVERING 可报异常）
   *
   * S5 修复：
   *   - 写 OrderEvent(ISSUE_REPORTED) → 订单维度查得到异常记录
   *   - WS 推 'customer-service' room → 客服实时介入
   *   - Order.status 保持（需客服介入决定后续状态推进）
   */
  async reportIssue(input: ReportIssueInput): Promise<DeliveryTaskView> {
    const riderId = await this.resolveRiderProfileId(input.riderId);
    const task = await db.deliveryTask.findUnique({ where: { id: input.taskId } });
    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (task.riderId !== riderId) {
      throw new ConflictException({
        code: 'E-DISPATCH-003',
        message: 'Task not assigned to this rider',
      });
    }

    // V2-S2 修复：状态前置校验（仅这几个状态允许报异常）
    const ALLOWED_STATUSES_FOR_ISSUE = ['ASSIGNED', 'PICKED_UP', 'DELIVERING'];
    if (!ALLOWED_STATUSES_FOR_ISSUE.includes(task.status)) {
      throw new ConflictException({
        code: 'E-DISPATCH-004',
        message: `Task status ${task.status} cannot report issue (only ${ALLOWED_STATUSES_FOR_ISSUE.join('/')} allowed)`,
      });
    }

    // 查 order.status 用于 OrderEvent（事务外预查，事务内不再读）
    const orderSnapshot = await db.order.findUnique({
      where: { id: task.orderId },
      select: { status: true },
    });

    // V2-S1 修复：双 DB 写操作包事务（deliveryTask.update + orderEvent.create）
    const updated = await withTransaction(async (tx: Tx) => {
      const t = await tx.deliveryTask.update({
        where: { id: input.taskId },
        data: {
          status: 'FAILED',
          note: `[ISSUE:${input.reason}]${input.note ? ' ' + input.note : ''}`,
        },
        include: {
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, status: true } },
          warehouse: { select: { code: true } },
        },
      });

      // 写 OrderEvent（同事务，避免 task FAILED 但 OrderEvent 缺失）
      // ISSUE_REPORTED 是审计事件，订单状态不变（fromStatus = toStatus = 当前 status）
      const currentOrderStatus = (orderSnapshot?.status ?? 'PICKED') as
        | 'PENDING_PAYMENT'
        | 'PENDING_CONFIRM'
        | 'CONFIRMED'
        | 'PICKED'
        | 'OUT_FOR_DELIVERY'
        | 'DELIVERED_PAID'
        | 'DELIVERED_UNPAID'
        | 'DELIVERED'
        | 'COMPLETED'
        | 'CANCELLED';
      await tx.orderEvent.create({
        data: {
          orderId: task.orderId,
          eventType: 'ISSUE_REPORTED',
          fromStatus: currentOrderStatus,
          toStatus: currentOrderStatus,
          operatorId: riderId,
          deviceType: 'RIDER_APP',
          perspective: null,
          metadata: {
            reason: input.reason,
            note: input.note,
            taskId: input.taskId,
          } as Prisma.InputJsonValue,
        },
      });

      return t;
    });

    // WS 推客服 room（事务外，避免 WS 失败回滚业务）
    try {
      this.realtime.server.to('customer-service').emit('dispatch:issue-reported', {
        taskId: input.taskId,
        orderId: task.orderId,
        riderId: riderId,
        reason: input.reason,
        note: input.note,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_ISSUE_FAILED',
        taskId: input.taskId,
        error: (e as Error).message,
      });
    }

    logger.warn({
      msg: 'DISPATCH_TASK_ISSUE_REPORTED',
      taskId: input.taskId,
      riderId: riderId,
      reason: input.reason,
    });

    return this.toView(updated);
  }

  /**
   * 创建配送任务（订单 CONFIRMED 时调）
   *
   * 由 OrderService.markPaid / confirmOrder 调用
   * 幂等：已存在 DeliveryTask 则跳过
   */
  async createTaskForOrder(orderId: string): Promise<DeliveryTaskView | null> {
    // P14 ④：orderId 去 @unique 改复合 @@unique([orderId, taskType])，findUnique 改 findFirst
    // 幂等：同 order 已有 delivery task 则跳过（return task 不影响，taskType 区分）
    const existing = await db.deliveryTask.findFirst({
      where: { orderId, taskType: 'delivery' },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });
    if (existing) {
      return this.toView(existing);
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        warehouse: { select: { id: true, code: true, address: true, centerLat: true, centerLng: true } },
      },
    });
    if (!order) {
      // P1-1 修复：raw Error → 业务错误码（避免全局 filter 映射为 500 无错误码）
      // 保留 message 里的 ORDER_NOT_FOUND 前缀以兼容现有测试期望
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: `ORDER_NOT_FOUND: ${orderId}`,
      });
    }

    const warehouse = order.warehouse;
    const pickupAddress = warehouse.address ?? `Warehouse ${warehouse.code}`;
    const pickupLat = warehouse.centerLat ? Number(warehouse.centerLat) : 0;
    const pickupLng = warehouse.centerLng ? Number(warehouse.centerLng) : 0;

    const dropoff = order.deliveryAddress as {
      name?: string;
      phone?: string;
      detail?: string;
      lat?: number;
      lng?: number;
    };
    const dropoffAddress = dropoff.detail ?? 'Customer address';
    const dropoffLat = dropoff.lat ?? 0;
    const dropoffLng = dropoff.lng ?? 0;

    const task = await db.deliveryTask.create({
      data: {
        orderId,
        riderId: null,
        warehouseId: order.warehouseId,
        status: 'PENDING_ASSIGN',
        pickupAddress,
        pickupLat: pickupLat,
        pickupLng: pickupLng,
        dropoffAddress,
        dropoffLat,
        dropoffLng,
        // P11 ETA：创建任务时算 now + DEFAULT_ETA_MINUTES（dispatch.config.ts），写 estimated_arrival
        estimatedArrival: new Date(Date.now() + DEFAULT_ETA_MINUTES * 60 * 1000),
      },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });

    try {
      this.realtime.server.to('riders').emit('dispatch:new-task', {
        taskId: task.id,
        orderId,
        orderNo: order.orderNo,
        warehouseId: order.warehouseId,
        warehouseCode: warehouse.code,
        pickupAddress,
        dropoffAddress,
        paymentMethod: order.paymentMethod,
        payableAmount: order.payableAmount,
        createdAt: task.createdAt.toISOString(),
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_NEW_TASK_FAILED',
        orderId,
        error: (e as Error).message,
      });
    }

    logger.info({
      msg: 'DISPATCH_TASK_CREATED',
      taskId: task.id,
      orderId,
      warehouseId: order.warehouseId,
    });

    return this.toView(task);
  }

  /**
   * P14 ④：建退货取件任务（refund APPROVE + RETURN_REFUND 触发）
   *
   * 决策 2 选 A（2026-08-11）：refund.service reviewRefund APPROVE 时同步调用本方法
   * 决策 3 选 A：复用抢单大厅（建任务 PENDING_ASSIGN + WS dispatch:new-task，骑手 acceptTask 抢）
   *
   * 与 createTaskForOrder 区别：
   *   - taskType='return'（非 delivery）
   *   - refundId 关联 refund（@unique 兜底防重）
   *   - pickupAddress=客户地址 / dropoffAddress=仓库地址（反向，骑手去客户那取退货商品回仓）
   *
   * 状态机：PENDING_ASSIGN -> ASSIGNED -> PICKED_UP -> DELIVERING -> DELIVERED
   *   - pickupTask（return）：写 refund.pickupAt
   *   - startDelivering（return）：写 refund.pickedAt（打通 DELIVERING 死状态）
   */
  async createTaskForReturn(refundId: string): Promise<DeliveryTaskView> {
    // 1. 查 refund（含 order + warehouse，校验存在 + refundType）
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            warehouseId: true,
            deliveryAddress: true,
            payableAmount: true,
            paymentMethod: true,
            warehouse: {
              select: { id: true, code: true, address: true, centerLat: true, centerLng: true },
            },
          },
        },
      },
    });
    if (!refund) {
      throw new NotFoundException({
        code: 'E-REFUND-003',
        message: `Refund not found: ${refundId}`,
      });
    }

    // 2. 校验 refundType=RETURN_REFUND（REFUND_ONLY 不建 return task）
    if (refund.refundType !== 'RETURN_REFUND') {
      throw new ConflictException({
        code: 'E-DISPATCH-022',
        message: `Refund ${refundId} not RETURN_REFUND type (current: ${refund.refundType})`,
      });
    }

    // 3. 校验无已有 return task（refundId @unique 兜底 + 应用层前置检查给清晰错误码）
    const existing = await db.deliveryTask.findFirst({
      where: { refundId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'E-DISPATCH-021',
        message: `Refund ${refundId} already has return task ${existing.id}`,
      });
    }

    // 4. 解析地址（return 任务：pickup=客户，dropoff=仓，与 delivery 反向）
    const order = refund.order;
    if (!order) {
      throw new NotFoundException({
        code: 'E-REFUND-005',
        message: `Order not found for refund: ${refund.orderId}`,
      });
    }
    const warehouse = order.warehouse;
    const dropoffAddress = warehouse.address ?? `Warehouse ${warehouse.code}`;
    const dropoffLat = warehouse.centerLat ? Number(warehouse.centerLat) : 0;
    const dropoffLng = warehouse.centerLng ? Number(warehouse.centerLng) : 0;

    const dropoff = order.deliveryAddress as {
      name?: string;
      phone?: string;
      detail?: string;
      lat?: number;
      lng?: number;
    };
    const pickupAddress = dropoff.detail ?? 'Customer address';
    const pickupLat = dropoff.lat ?? 0;
    const pickupLng = dropoff.lng ?? 0;

    // 5. 建 return task（PENDING_ASSIGN，复用抢单大厅）
    const task = await db.deliveryTask.create({
      data: {
        orderId: refund.orderId,
        riderId: null,
        warehouseId: order.warehouseId,
        status: 'PENDING_ASSIGN',
        taskType: 'return',
        refundId: refund.id,
        pickupAddress,
        pickupLat,
        pickupLng,
        dropoffAddress,
        dropoffLat,
        dropoffLng,
        estimatedArrival: new Date(Date.now() + DEFAULT_ETA_MINUTES * 60 * 1000),
      },
      include: {
        // P0-1 修复：补 deliveryFee
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true, deliveryAddress: true, deliveryFee: true } },
        warehouse: { select: { code: true } },
      },
    });

    // 6. WS 推 riders room（复用抢单大厅，决策 3）
    try {
      this.realtime.server.to('riders').emit('dispatch:new-task', {
        taskId: task.id,
        orderId: refund.orderId,
        orderNo: order.orderNo,
        warehouseId: order.warehouseId,
        warehouseCode: warehouse.code,
        taskType: 'return',
        refundId: refund.id,
        pickupAddress,
        dropoffAddress,
        paymentMethod: order.paymentMethod,
        payableAmount: order.payableAmount,
        createdAt: task.createdAt.toISOString(),
      });
    } catch (e) {
      logger.warn({
        msg: 'DISPATCH_BROADCAST_NEW_RETURN_TASK_FAILED',
        refundId,
        error: (e as Error).message,
      });
    }

    logger.info({
      msg: 'DISPATCH_RETURN_TASK_CREATED',
      taskId: task.id,
      refundId,
      orderId: refund.orderId,
      warehouseId: order.warehouseId,
    });

    return this.toView(task);
  }

  // ==========================================================================
  // Admin 视角（批次 4：admin dispatch 看板）
  // ==========================================================================

  /** admin 任务监控列表（游标分页 + filter） */
  async listAllTasks(options: ListAllTasksInput): Promise<{
    items: AdminDeliveryTaskView[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = Math.min(options.limit ?? 50, 100);
    const where: Prisma.DeliveryTaskWhereInput = {};
    if (options.status) where.status = options.status;
    if (options.warehouseId) where.warehouseId = options.warehouseId;
    if (options.riderId) where.riderId = options.riderId;
    if (options.orderNo) {
      where.order = { orderNo: { contains: options.orderNo, mode: 'insensitive' } };
    }

    const tasks = await db.deliveryTask.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: {
        order: { select: { orderNo: true, status: true, payableAmount: true, paymentMethod: true } },
        rider: { select: { id: true, riderName: true, phone: true } },
        warehouse: { select: { code: true } },
      },
    });
    const hasMore = tasks.length > limit;
    const items = hasMore ? tasks.slice(0, limit) : tasks;
    return {
      items: items.map((t) => this.toAdminView(t)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
    };
  }

  /** admin 任务详情（含 order + rider） */
  async getAdminDetail(taskId: string): Promise<AdminDeliveryTaskView> {
    const task = await db.deliveryTask.findUnique({
      where: { id: taskId },
      include: {
        order: { select: { orderNo: true, status: true, payableAmount: true, paymentMethod: true } },
        rider: { select: { id: true, riderName: true, phone: true } },
        warehouse: { select: { code: true } },
      },
    });
    if (!task) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    return this.toAdminView(task);
  }

  /**
   * 改派骑手（事务双写，第一期只支持 ASSIGNED）
   *
   * 事务编排（复用 acceptTask 乐观锁模式）：
   *   - 事务外查 task（status 校验 + orderId + 旧 riderId + note）
   *   - 校验新骑手 APPROVED
   *   - 事务内：乐观锁 UPDATE delivery_tasks WHERE status='ASSIGNED' + order.riderId 同步
   *   - note 追加改派记录（保留原 note，审计连续性）
   *   - 不写 OrderEvent（reassign 不改订单状态，靠 @Audit + note 留痕）
   */
  async reassignTask(input: {
    taskId: string;
    newRiderId: string;
    adminUserId: string;
    reason?: string;
  }): Promise<AdminDeliveryTaskView> {
    const now = new Date();

    const taskBefore = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      select: { orderId: true, status: true, riderId: true, note: true },
    });
    if (!taskBefore) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (taskBefore.status !== 'ASSIGNED') {
      throw new ConflictException({
        code: 'E-DISPATCH-006',
        message: `Reassign requires ASSIGNED status (current: ${taskBefore.status}; PICKED_UP+ 需先 cancel 再 recreate)`,
      });
    }

    const newRider = await db.riderProfile.findUnique({
      where: { id: input.newRiderId },
      select: { id: true, applicationStatus: true, riderName: true },
    });
    if (!newRider || newRider.applicationStatus !== 'APPROVED') {
      throw new ConflictException({
        code: 'E-DISPATCH-008',
        message: 'New rider invalid (not found or not APPROVED)',
      });
    }

    const noteText = `[reassign] ${taskBefore.riderId ?? 'null'} → ${newRider.riderName}(${input.newRiderId}) by ${input.adminUserId}${input.reason ? ` | ${input.reason}` : ''}`;
    const newNote = taskBefore.note ? `${taskBefore.note}\n${noteText}` : noteText;

    const result = await withTransaction(async (tx: Tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "delivery_tasks"
        SET rider_id = ${input.newRiderId},
            assigned_at = ${now},
            updated_at = ${now},
            note = ${newNote}
        WHERE id = ${input.taskId} AND status = 'ASSIGNED'
      `;
      if (updated === 0) return { ok: false as const };
      await tx.order.update({
        where: { id: taskBefore.orderId },
        data: { riderId: input.newRiderId },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      throw new ConflictException({
        code: 'E-DISPATCH-006',
        message: 'Reassign failed (task status changed concurrently)',
      });
    }

    logger.info({
      msg: 'DISPATCH_TASK_REASSIGNED',
      taskId: input.taskId,
      oldRiderId: taskBefore.riderId,
      newRiderId: input.newRiderId,
      adminUserId: input.adminUserId,
    });

    return this.getAdminDetail(input.taskId);
  }

  /**
   * 取消配送任务（事务双写，PENDING_ASSIGN / ASSIGNED）
   *
   * task FAILED + order.riderId=null（不取消订单，等 recreate 或 admin-order cancel）
   * 不写 OrderEvent（不改订单状态，靠 @Audit + note 留痕）
   */
  async cancelTask(input: {
    taskId: string;
    adminUserId: string;
    reason?: string;
  }): Promise<AdminDeliveryTaskView> {
    const now = new Date();

    const taskBefore = await db.deliveryTask.findUnique({
      where: { id: input.taskId },
      select: { orderId: true, status: true, riderId: true, note: true },
    });
    if (!taskBefore) {
      throw new NotFoundException({ code: 'E-DISPATCH-001', message: 'Task not found' });
    }
    if (taskBefore.status !== 'PENDING_ASSIGN' && taskBefore.status !== 'ASSIGNED') {
      throw new ConflictException({
        code: 'E-DISPATCH-007',
        message: `Cancel requires PENDING_ASSIGN or ASSIGNED (current: ${taskBefore.status}; 已取货/配送中走 reportIssue)`,
      });
    }

    const noteText = `[cancel] by ${input.adminUserId}${input.reason ? ` | ${input.reason}` : ''}`;
    const newNote = taskBefore.note ? `${taskBefore.note}\n${noteText}` : noteText;

    const result = await withTransaction(async (tx: Tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "delivery_tasks"
        SET status = 'FAILED',
            rider_id = NULL,
            updated_at = ${now},
            note = ${newNote}
        WHERE id = ${input.taskId} AND status IN ('PENDING_ASSIGN', 'ASSIGNED')
      `;
      if (updated === 0) return { ok: false as const };
      await tx.order.update({
        where: { id: taskBefore.orderId },
        data: { riderId: null },
      });
      return { ok: true as const };
    });

    if (!result.ok) {
      throw new ConflictException({
        code: 'E-DISPATCH-007',
        message: 'Cancel failed (task status changed concurrently)',
      });
    }

    logger.info({
      msg: 'DISPATCH_TASK_CANCELLED',
      taskId: input.taskId,
      orderId: taskBefore.orderId,
      adminUserId: input.adminUserId,
    });

    return this.getAdminDetail(input.taskId);
  }

  /**
   * 可派骑手列表（APPROVED + Redis isOnline 标记，在线优先 + 熟手优先排序）
   *
   * Redis key：rider:online:{userId}（rider.service heartbeat 维护，SETEX 60s）
   */
  async listAvailableRiders(): Promise<AvailableRider[]> {
    const profiles = await db.riderProfile.findMany({
      where: { applicationStatus: 'APPROVED' },
      select: {
        id: true,
        userId: true,
        riderName: true,
        phone: true,
        vehicleType: true,
        totalDeliveries: true,
        rating: true,
      },
    });

    if (profiles.length === 0) return [];

    // pipeline 批量 EXISTS（1 次 round-trip；审查 P3-1：避免 N 次串行 round-trip 开销）
    let onlineFlags: boolean[];
    try {
      const pipeline = redis.pipeline();
      profiles.forEach((p) => pipeline.exists(`rider:online:${p.userId}`));
      const results = await pipeline.exec();
      onlineFlags = (results ?? []).map((r) => (r[1] as number) > 0);
    } catch {
      // Redis 故障降级：全离线（不阻塞 admin 查询）
      onlineFlags = profiles.map(() => false);
    }

    const withOnline: AvailableRider[] = profiles.map((p, i) => ({
      id: p.id,
      riderName: p.riderName,
      phone: p.phone,
      vehicleType: p.vehicleType,
      isOnline: onlineFlags[i] ?? false,
      totalDeliveries: p.totalDeliveries,
      rating: Number(p.rating),
    }));

    // 在线优先，其次按接单数（熟手优先）
    return withOnline.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
      return b.totalDeliveries - a.totalDeliveries;
    });
  }

  /** admin 视图转换（含 order + rider 关联） */
  private toAdminView(t: any): AdminDeliveryTaskView {
    return {
      id: t.id,
      orderId: t.orderId,
      riderId: t.riderId,
      warehouseId: t.warehouseId,
      status: t.status,
      taskType: (t.taskType as 'delivery' | 'return') ?? 'delivery',
      refundId: t.refundId ?? null,
      pickupAddress: t.pickupAddress,
      pickupLat: Number(t.pickupLat),
      pickupLng: Number(t.pickupLng),
      dropoffAddress: t.dropoffAddress,
      dropoffLat: Number(t.dropoffLat),
      dropoffLng: Number(t.dropoffLng),
      assignedAt: t.assignedAt?.toISOString() ?? null,
      pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
      deliveredAt: t.deliveredAt?.toISOString() ?? null,
      estimatedArrival: t.estimatedArrival?.toISOString() ?? null,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      warehouseCode: t.warehouse?.code ?? '',
      order: {
        orderNo: t.order?.orderNo ?? '',
        status: t.order?.status ?? '',
        payableAmount: t.order?.payableAmount != null ? Number(t.order.payableAmount) : null,
        paymentMethod: t.order?.paymentMethod ?? '',
      },
      rider: t.rider
        ? { id: t.rider.id, riderName: t.rider.riderName, phone: t.rider.phone }
        : null,
    };
  }

  /**
   * User.id（JWT sub）→ RiderProfile.id 解析
   *
   * dispatch.controller 传的 riderId 实际是 user.sub（User.id），
   * 但 delivery_tasks.rider_id / orders.rider_id 外键引用 RiderProfile.id。
   * 此方法在 service 入口统一解析，避免 FK 违反。
   */
  private async resolveRiderProfileId(userId: string): Promise<string> {
    const profile = await db.riderProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) {
      throw new NotFoundException({
        code: 'E-RIDER-001',
        message: 'Rider profile not found (please apply first)',
      });
    }
    return profile.id;
  }

  /** 转换为 API 视图（Decimal → number，Date → ISO 字符串） */
  // P0 修复：参数类型改为宽松类型，接受实际 Prisma 查询结果（warehouse 只含 code）
  private toView(
    t: any,  // 宽松类型（运行时不会 crash，JS 不检查类型）
  ): DeliveryTaskView {
    // W7 补：订单项摘要（从 productName JSON 取当前语言，fallback en）
    // 注意：order.items 可能不存在（查询时没 include），需要 null 检查
    const items = (t.order as any)?.items as Array<{ productName: unknown; quantity: number }> | undefined;
    const itemsSummary = items
      ?.map((item) => {
        const nameObj = item.productName as Record<string, string> | null;
        const name = nameObj?.en ?? nameObj?.zh ?? nameObj?.id ?? nameObj?.pt ?? 'Unknown';
        return `${name} x${item.quantity}`;
      })
      .join(', ');

    // P6 #7 配送距离/时长（pickup → dropoff 的 Haversine 距离 + 时长推导）
    // 任一坐标缺失（含 (0,0) 哨兵——历史无坐标存 0，haversine(0,0,0,0) 返回 0 不是 null，需显式拦截）→ undefined，前端降级隐藏
    const pLat = Number(t.pickupLat);
    const pLng = Number(t.pickupLng);
    const dLat = Number(t.dropoffLat);
    const dLng = Number(t.dropoffLng);
    const hasCoords =
      [pLat, pLng, dLat, dLng].every(Number.isFinite) && !(pLat === 0 && pLng === 0 && dLat === 0 && dLng === 0);
    const distanceKm = hasCoords ? haversineDistanceKm(pLat, pLng, dLat, dLng) : null;
    // P3-8 修复：上限显式传 DEFAULT_ETA_MINUTES，与 estimatedArrival SLA 同源，避免配置漂移时两处静默不一致
    const estimatedMinutes =
      distanceKm != null ? estimateMinutesFromDistance(distanceKm, 20, DEFAULT_ETA_MINUTES) ?? undefined : undefined;

    return {
      id: t.id,
      orderId: t.orderId,
      riderId: t.riderId,
      warehouseId: t.warehouseId,
      status: t.status,
      taskType: (t.taskType as 'delivery' | 'return') ?? 'delivery',
      refundId: t.refundId ?? null,
      pickupAddress: t.pickupAddress,
      pickupLat: Number(t.pickupLat),
      pickupLng: Number(t.pickupLng),
      dropoffAddress: t.dropoffAddress,
      dropoffLat: Number(t.dropoffLat),
      dropoffLng: Number(t.dropoffLng),
      assignedAt: t.assignedAt?.toISOString() ?? null,
      pickedUpAt: t.pickedUpAt?.toISOString() ?? null,
      deliveredAt: t.deliveredAt?.toISOString() ?? null,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
      orderNo: (t.order as any)?.orderNo,
      warehouseCode: (t.warehouse as any)?.code,
      payableAmount: (t.order as any)?.payableAmount,
      paymentMethod: (t.order as any)?.paymentMethod,
      deliveryFee: (t.order as any)?.deliveryFee,
      itemsSummary,
      // T6 联系拨号：从 order.deliveryAddress JSON 取 phone（下单时已存，历史订单可能无）
      contactPhone:
        ((t.order as any)?.deliveryAddress as { phone?: string } | null)?.phone ?? undefined,
      distanceKm: distanceKm ?? undefined,
      estimatedMinutes,
    };
  }
}
