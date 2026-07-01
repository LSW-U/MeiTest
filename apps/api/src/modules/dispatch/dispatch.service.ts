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

/** DeliveryTask 列表项视图 */
export interface DeliveryTaskView {
  id: string;
  orderId: string;
  riderId: string | null;
  warehouseId: string;
  status: 'PENDING_ASSIGN' | 'ASSIGNED' | 'PICKED_UP' | 'DELIVERING' | 'DELIVERED' | 'FAILED';
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
  /** W7 补字段：配送费 */
  deliveryFee?: number;
  /** W7 补字段：订单项摘要（如"牛奶 x1, 鸡蛋 x2"） */
  itemsSummary?: string;
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
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
        warehouse: { select: { code: true } },
      },
    });

    return {
      items: tasks.map((t) => this.toView(t)),
    };
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
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
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

    const updated = await db.deliveryTask.update({
      where: { id: input.taskId },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
        note: input.note ?? task.note,
      },
      include: {
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
        warehouse: { select: { code: true } },
      },
    });

    // 同步 Order 状态机：CONFIRMED → PICKED
    await db.order.update({
      where: { id: task.orderId },
      data: { status: 'PICKED', pickedAt: new Date() },
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
          order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
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
    const existing = await db.deliveryTask.findUnique({
      where: { orderId },
      include: {
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
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
      },
      include: {
        order: { select: { orderNo: true, payableAmount: true, paymentMethod: true } },
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
  private toView(
    t: Prisma.DeliveryTaskGetPayload<{
      include: {
        order?: {
          select?: {
            orderNo?: true;
            payableAmount?: true;
            deliveryFee?: true;
            items?: {
              select?: {
                productName?: true;
                quantity?: true;
              };
            };
          };
        };
        warehouse?: { select?: { code?: true } };
      };
    }>,
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

    return {
      id: t.id,
      orderId: t.orderId,
      riderId: t.riderId,
      warehouseId: t.warehouseId,
      status: t.status,
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
      deliveryFee: (t.order as any)?.deliveryFee,
      itemsSummary,
    };
  }
}
