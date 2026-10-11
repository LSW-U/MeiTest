/**
 * Refund Service — 退款售后（W5 流程 C）
 *
 * MVP 简化规则：
 *   - 接单前（PENDING_PAYMENT / PENDING_CONFIRM）：全额退，自动通过
 *   - 接单后（CONFIRMED 及之后）：商家决定（APPROVE / REJECT）
 *   - 原路回款：mock（标 MOCK_ 前缀），W6 切真实微信退款 API
 *
 * 状态机：
 *   PENDING → APPROVED → COMPLETED（商家通过 + 系统退款）
 *   PENDING → REJECTED（商家驳回）
 *   PENDING → CANCELLED（客户撤回）
 *   APPROVED → FAILED（第三方退款失败，mock 不触发）
 */
import { Injectable, NotFoundException, ConflictException, ForbiddenException, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  db,
  withTransaction,
  rollbackSalesCountForRefundItems,
  rollbackSalesCountForFullOrder,
  releaseStock,
} from '../../shared/db';
import type { Tx } from '../../shared/db';
// D8（方案v3 20261012）：退款负向调整 Settlement（settle 模块 helper，refund → settle 单向依赖）
import { applyRefundSettlementAdjustment } from '../settle/real-order-aggregator.service';
import { logger } from '../../shared/logger/logger';
// P1-5：cancelOrderInTx 需要 toPrismaDeviceType（OrderEvent 写入）
import { toPrismaDeviceType } from '../order/order.types';
// P1-5（2026-10-11）：cancelOrderInTx 事务内直取，OrderService/ModuleRef 注入已不再需要
// import { OrderService } from '../order/order.service';  ← 已删除（原事务外 cancelOrderInternal 调用点）
// P14 ④：refund APPROVE + RETURN_REFUND 触发建 return task（DispatchService via ModuleRef，避免循环依赖）
import { DispatchService } from '../dispatch/dispatch.service';
import { StorageService } from '../../shared/storage/storage.service';
import { Prisma } from '../../prisma/client';

/** 接单前可自动通过的状态 */
const AUTO_APPROVE_STATUSES = ['PENDING_PAYMENT', 'PENDING_CONFIRM'];

export interface CreateRefundInput {
  orderId: string;
  userId: string;
  reason: string;
  reasonDetail?: string;
  /** 部分退款商品列表（不传 = 整单全额退款，向后兼容） */
  items?: { orderItemId: string; refundQty: number }[];
  /** 凭证照片 URL 数组（前端先调 /client/uploads/refund-evidence 拿 URL 再提交；P13 售后图片 2026-08-10） */
  photos?: string[];
  /** 售后类型：REFUND_ONLY 仅退款 / RETURN_REFUND 退货退款（P14-defer 2026-08-10；不传默认 REFUND_ONLY 向后兼容） */
  refundType?: 'REFUND_ONLY' | 'RETURN_REFUND';
}

/** 退款商品子表项视图（P13 部分退款，2026-08-08） */
export interface RefundItemView {
  id: string;
  refundId: string;
  orderItemId: string;
  skuId: string;
  productName: Record<string, string>;
  unitPrice: number;
  refundQty: number;
  subtotal: number;
}

export interface RefundView {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  reason: string;
  reasonDetail: string | null;
  status: string;
  transactionId: string | null;
  refundMethod: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** 退款商品列表（整单退款时为空数组） */
  items: RefundItemView[];
  /** 凭证照片 URL 数组（P13 售后图片 2026-08-10） */
  photos: string[];
  /** 售后类型：REFUND_ONLY 仅退款 / RETURN_REFUND 退货退款（P14-defer 2026-08-10，替代 reason 启发式） */
  refundType: string;
  /** 骑手接单取件时间（dispatch 集成 defer，当前 null；P14 时间轴 pickupArranging 步骤展示） */
  pickupAt: string | null;
  /** 骑手取件完成时间（dispatch 集成 defer，当前 null；P14 时间轴 picked 步骤展示） */
  pickedAt: string | null;
}

@Injectable()
export class RefundService {
  constructor(
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  /**
   * 客户申请退款
   *
   * 规则：
   *   - 同一订单只能有一个非终态 refund（PENDING/APPROVED）
   *   - 接单前状态自动通过 + mock 退款完成 + 自动取消订单释放库存
   *   - 接单后状态需商家审核
   */
  async createRefund(input: CreateRefundInput): Promise<RefundView> {
    // 查订单
    const order = await db.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'E-REFUND-005',
        message: `Order not found: ${input.orderId}`,
      });
    }

    // 校验订单归属（资源不属于当前用户 → 403，非 409 状态冲突）
    if (order.userId !== input.userId) {
      throw new ForbiddenException({
        code: 'E-AUTH-012',
        message: 'Order does not belong to this user',
      });
    }

    // 校验订单状态（已取消/已完成不可退）
    if (order.status === 'CANCELLED') {
      throw new ConflictException({
        code: 'E-REFUND-001',
        message: 'Cannot refund a cancelled order',
      });
    }

    // 校验是否已有进行中的退款（事务外快查，快速失败给 409；权威校验在事务内，见 withTransaction 块）
    // P1-4（方案v2 20261011）：本检查在事务外存在 TOCTOU 竞态——并发双 POST 都读到
    // 「无进行中退款」→ 双插 PENDING。事务内用同订单维度 advisory lock（withdraw.service
    // createRequest 先例）串行化后重查，杜绝双插（Refund 0 唯一约束，见评估结论）。
    const existing = await db.refund.findFirst({
      where: {
        orderId: input.orderId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'E-REFUND-002',
        message: `Refund already in progress (status: ${existing.status})`,
      });
    }

    // 查支付方式
    const paymentIntent = await db.paymentIntent.findUnique({
      where: { orderId: input.orderId },
    });
    const refundMethod = paymentIntent?.method ?? 'COD';

    // 判断是否自动通过
    const autoApprove = AUTO_APPROVE_STATUSES.includes(order.status);

    // P13 金额分叉：有 items 按选中商品算部分退款 / 无 items 整单全额（向后兼容）
    let amount: number;
    let refundItemsData: { orderItemId: string; refundQty: number; subtotal: number }[] = [];

    if (input.items && input.items.length > 0) {
      // P2-2（审查 2026-09-07）：整单退款（无 RefundItem）不落逐行痕迹，部分退款累计校验
      // 对其失明 → 「整单退款完成后再申请部分退款」会二次退款/二次回滚销量，显式拒绝
      const completedFullRefund = await db.refund.findFirst({
        where: { orderId: input.orderId, status: 'COMPLETED', items: { none: {} } },
        select: { id: true },
      });
      if (completedFullRefund) {
        throw new ConflictException({
          code: 'E-REFUND-009',
          message: 'Order already fully refunded (completed full refund exists)',
        });
      }

      // P1 累计校验（审查报告 B.7，金额安全）：existing 只防 PENDING/APPROVED 的进行中退款，
      // 不防已 COMPLETED 的历史部分退款 -> 查累计 refundQty，防同一 OrderItem 超额退款
      const previousItems = await db.refundItem.findMany({
        where: {
          orderItemId: { in: input.items.map((i) => i.orderItemId) },
          refund: { orderId: input.orderId, status: 'COMPLETED' },
        },
        select: { orderItemId: true, refundQty: true },
      });
      const refundedMap = new Map<string, number>();
      for (const pi of previousItems) {
        refundedMap.set(pi.orderItemId, (refundedMap.get(pi.orderItemId) ?? 0) + pi.refundQty);
      }

      amount = 0;
      for (const ri of input.items) {
        const oi = order.items.find((x) => x.id === ri.orderItemId);
        if (!oi) {
          throw new ConflictException({
            code: 'E-REFUND-008',
            message: `OrderItem not found in this order: ${ri.orderItemId}`,
          });
        }
        const alreadyRefunded = refundedMap.get(ri.orderItemId) ?? 0;
        const remaining = oi.quantity - alreadyRefunded;
        if (ri.refundQty > remaining) {
          throw new ConflictException({
            code: 'E-REFUND-009',
            message:
              alreadyRefunded > 0
                ? `refundQty (${ri.refundQty}) exceeds remaining refundable quantity (${remaining}, after ${alreadyRefunded} already refunded of ${oi.quantity})`
                : `refundQty (${ri.refundQty}) exceeds item quantity (${oi.quantity})`,
          });
        }
        const subtotal = oi.unitPrice * ri.refundQty;
        amount += subtotal;
        refundItemsData.push({ orderItemId: ri.orderItemId, refundQty: ri.refundQty, subtotal });
      }
    } else {
      amount = order.payableAmount;
    }

    // P13 审查 P1 修复：photos URL 必须由本服务 client upload 端点生成（防 SSRF/追踪/钓鱼）
    if (input.photos && input.photos.length > 0) {
      for (const photoUrl of input.photos) {
        if (!this.storage.isOwnUrl(photoUrl)) {
          throw new ConflictException({
            code: 'E-REFUND-011',
            message: `Photo URL must be from our upload service: ${photoUrl}`,
          });
        }
      }
    }

    // 金额边界校验
    if (amount <= 0) {
      throw new ConflictException({
        code: 'E-REFUND-006',
        message: 'Refund amount must be > 0',
      });
    }
    if (amount > order.payableAmount) {
      throw new ConflictException({
        code: 'E-REFUND-010',
        message: `Refund amount ${amount} exceeds order payable ${order.payableAmount}`,
      });
    }
    // P2-2（审查 2026-09-07）：整单退款金额累计校验——Σ 已 COMPLETED 退款金额 + 本次 amount
    // 不得超过 payableAmount，封死「部分退款后再整单退款」「整单退款后再整单退款」的
    // 重复退款（金额超额退 + 销量双重回滚）口子。整单退款 amount=payableAmount，
    // 该校验为精确口径；部分退款已有逐行 qty 累计校验（E-REFUND-009），不在此重复
    if (!input.items || input.items.length === 0) {
      const completedSum = await db.refund.aggregate({
        where: { orderId: input.orderId, status: 'COMPLETED' },
        _sum: { amount: true },
      });
      const refundedAmount = completedSum._sum.amount ?? 0;
      if (refundedAmount + amount > order.payableAmount) {
        throw new ConflictException({
          code: 'E-REFUND-009',
          message: `Order already refunded ${refundedAmount} of ${order.payableAmount}; full refund would exceed payable`,
        });
      }
    }

    // 批A（2026-09-07）：autoApprove 经 completeRefundTx 单点标 COMPLETED（销量回滚守卫同事务）
    // 未支付订单（PENDING_PAYMENT/PENDING_CONFIRM）从未累加过销量，completeRefundTx 内守卫会跳过回滚
    const refund = await withTransaction(async (tx) => {
      // P1-4（方案v2 20261011）：in-flight 权威校验移入事务内。与 withdraw.service.createRequest
      // 同款 pg_advisory_xact_lock（同订单维度 hash key）——并发双 POST 在锁上串行化，
      // 后到者读到先到者已插入的 PENDING → E-REFUND-002，杜绝双插。
      // ⚠️ 两参整型对（P1-1 修复 20261012）：hashtext() 返回 integer，PG 两参重载只有
      // (integer, integer)——不能 ::bigint（42883，真库实证）。域隔离：withdraw 用单参
      // bigint 键（typePart<<56 | hash），本处两参 (3, hashtext) 的同 64 位键空间区间
      // 不重叠（withdraw 高位 typePart 段 vs 低位 int 对），互不干扰。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(3, hashtext(${input.orderId}))`;
      const inFlight = await tx.refund.findFirst({
        where: {
          orderId: input.orderId,
          status: { in: ['PENDING', 'APPROVED'] },
        },
        select: { status: true },
      });
      if (inFlight) {
        throw new ConflictException({
          code: 'E-REFUND-002',
          message: `Refund already in progress (status: ${inFlight.status})`,
        });
      }

      const created = await tx.refund.create({
        data: {
          orderId: input.orderId,
          userId: input.userId,
          amount,
          reason: input.reason,
          reasonDetail: input.reasonDetail ?? null,
          photos: input.photos ?? [],
          refundType: input.refundType ?? 'REFUND_ONLY',
          status: 'PENDING',
          refundMethod,
          items:
            input.items && input.items.length > 0
              ? {
                  create: refundItemsData.map((ri) => {
                    const oi = order.items.find((x) => x.id === ri.orderItemId)!;
                    return {
                      orderItemId: ri.orderItemId,
                      skuId: oi.skuId,
                      productName: oi.productName as Prisma.InputJsonValue,
                      unitPrice: oi.unitPrice,
                      refundQty: ri.refundQty,
                      subtotal: ri.subtotal,
                    };
                  }),
                }
              : undefined,
        },
        include: { items: true },
      });

      if (autoApprove) {
        // P1-5（方案v2 20261011）：订单取消收进同一事务——退款 COMPLETED 与订单 CANCELLED
        // 原子提交，取消失败必须抛错回滚（账实不符 = 退款完成而订单未取消）。原实现把
        // cancelOrderInternal 放事务外且 catch 吞错（REFUND_AUTO_APPROVE_CANCEL_ORDER_FAILED
        // 不抛）/ OrderService null 不阻塞两处「人工介入」路径均已删除。
        // cancelOrderInternal 带 tx 版本：P1-6 WHERE status 守卫保证并发取消只有一笔释放库存，
        // 已终态幂等 return（同一订单已被超时 job 取消时本事务不炸）。
        await this.cancelOrderInTx(tx, input.orderId, {
          operatorId: order.userId,
          deviceType: 'client_app',
          perspective: 'customer',
          reason: 'REFUND_AUTO_APPROVED',
        });
        return this.completeRefundTx(tx, created.id, { reviewerId: null, reviewNote: null });
      }
      return created;
    });

    // 自动通过时订单取消已在事务内完成（P1-5）；此处只保留成功留痕
    if (autoApprove) {
      logger.info({
        msg: 'REFUND_AUTO_COMPLETED_WITH_ORDER_CANCEL',
        refundId: refund.id,
        orderId: input.orderId,
        amount,
        reason: 'order not yet confirmed, cancelled + stock released in same tx',
      });
    } else {
      logger.info({
        msg: 'REFUND_CREATED',
        refundId: refund.id,
        orderId: input.orderId,
        amount,
        status: 'PENDING',
      });
    }

    return this.toView(refund);
  }

  /**
   * P1-5（方案v2 20261011）：事务内取消订单（自动退款同事务收口）
   *
   * cancelOrderInternal 的 tx 版本：复用同一 cancelOrderInternal 逻辑但接收外部 tx，
   * 不再自开事务。实现保持与 order.service.cancelOrderInternal 同构：
   *   - WHERE status notIn (CANCELLED, COMPLETED) 条件守卫（P1-6 先例）——已终态幂等
   *     return（订单已被超时 job / 用户并发取消时不炸本事务）
   *   - 释放库存 + 写 OrderEvent + 关闭未接单任务
   *   - 失败抛错 → 外层 withTransaction 整体回滚（退款不落地）
   *
   * P0 修复保留：接单前退款必须同步取消订单 + 释放库存
   *
   * ⚠️ P3-1（审查 20261012）互引锚点：本方法与 order.service.ts cancelOrderInternal（:711 起，
   * 守卫 :739）是刻意保留的平行实现——本方法接收外部 tx 供退款同事务收口，order.service 版
   * 自开事务供取消链路复用。两版逻辑（守卫/releaseStock/OrderEvent/关任务/清 riderId）必须
   * 保持同构，任何一侧加列/改口径时另一侧同步改，漂移风险见审查报告 P3-1。
   */
  private async cancelOrderInTx(
    tx: Tx,
    orderId: string,
    ctx: {
      operatorId?: string;
      deviceType?: string;
      perspective?: string;
      reason: string;
    },
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'E-ORDER-004',
        message: `Order not found: ${orderId}`,
      });
    }
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') {
      // 幂等：已终态直接 return
      logger.info({
        msg: 'REFUND_AUTO_APPROVE_ORDER_ALREADY_TERMINAL',
        orderId,
        status: order.status,
      });
      return;
    }

    // P1-6 同款 WHERE status 守卫：并发取消只有一笔翻走
    const flipped = await tx.order.updateMany({
      where: { id: orderId, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: ctx.reason,
      },
    });
    if (flipped.count === 0) {
      logger.info({
        msg: 'REFUND_AUTO_APPROVE_CANCEL_CONCURRENT_LOSER',
        orderId,
      });
      return;
    }

    // 释放库存（同事务）
    for (const item of order.items) {
      await releaseStock(tx, order.warehouseId, item.skuId, item.quantity, 'RELEASE', {
        reason: ctx.reason,
        referenceType: 'ORDER',
        referenceId: order.id,
        operatorId: ctx.operatorId,
      });
    }

    await tx.orderEvent.create({
      data: {
        orderId,
        eventType: 'CANCELLED',
        fromStatus: order.status,
        toStatus: 'CANCELLED',
        operatorId: ctx.operatorId ?? null,
        deviceType: toPrismaDeviceType(ctx.deviceType as never),
        perspective: ctx.perspective ?? null,
        metadata: { reason: ctx.reason } as Prisma.InputJsonValue,
      },
    });

    // 联动关闭未接单/已接单任务（对齐 order.service.cancelOrderInternal 联动口径）
    const cancelledTasks = await tx.deliveryTask.updateMany({
      where: { orderId, status: { in: ['PENDING_ASSIGN', 'ASSIGNED'] } },
      data: { status: 'FAILED' },
    });
    if (cancelledTasks.count > 0 && order.riderId) {
      await tx.order.update({
        where: { id: orderId },
        data: { riderId: null },
      });
    }

    logger.info({
      msg: 'ORDER_CANCELLED_IN_REFUND_TX',
      orderId,
      orderNo: order.orderNo,
      fromStatus: order.status,
      reason: ctx.reason,
    });
  }

  /**
   * 退款完成单点（批A 销量真实统计 2026-09-07）
   *
   * 两条 COMPLETED 路径共用（调用方各自包 withTransaction）：
   *   - createRefund autoApprove（接单前自动通过，reviewerId=null）
   *   - reviewRefund APPROVE（商家审核通过）
   *
   * 做的事：
   *   1. refund → COMPLETED（写 transactionId / completedAt / 审核字段）
   *   2. 销量回滚（与 COMPLETED 同事务，任一失败整体回滚）：
   *      - 仅对「曾累加过销量」的订单回滚：预付 paymentStatus=PAID（markPaidTx 累加）
   *        或 COD 有收款成功记录（deliverTask 累加）；未支付订单从未累加，跳过防误减
   *      - 有 RefundItem（部分退款）→ 按 skuId→productId × refundQty 递减
   *      - 无 RefundItem（整单退款）→ 按 OrderItem 剩余未回滚数量递减
   *
   * 不做：return task 创建（dispatch 集成，事务外）、通知
   *
   * APPROVED → FAILED（第三方退款失败）不走本方法，不回滚
   */
  private async completeRefundTx(
    tx: Tx,
    refundId: string,
    opts: { reviewerId?: string | null; reviewNote?: string | null },
  ): Promise<Prisma.RefundGetPayload<{ include: { items: true } }>> {
    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: { items: true },
    });
    if (!refund) {
      throw new NotFoundException({
        code: 'E-REFUND-003',
        message: `Refund not found: ${refundId}`,
      });
    }

    const order = await tx.order.findUnique({
      where: { id: refund.orderId },
      // D8：warehouse.shopId 供退款负向调整 Settlement 归属商家（subjectId=shopId）
      select: { id: true, paymentStatus: true, paymentMethod: true, warehouse: { select: { shopId: true } } },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'E-REFUND-005',
        message: `Order not found for refund: ${refund.orderId}`,
      });
    }

    // 1. 标记 COMPLETED（审核字段仅商家审核路径写入，autoApprove 保持 reviewedBy/reviewedAt 空）
    //    P2-1（审查 2026-09-07）：条件翻转封并发双批 TOCTOU——双击审批 / admin cancel 自动
    //    通过与人工审批赛跑时，两事务都可能读到 PENDING 快照；以 status='PENDING' 作
    //    UPDATE 前置（行锁 + 提交后 WHERE 复核）只有一笔能翻走，输家 count=0 抛 E-REFUND-004。
    //    autoApprove 同事务新建场景 status 本就是 PENDING，count=1 兼容。
    const flipData = {
      status: 'COMPLETED' as const,
      transactionId: this.generateMockTransactionId(),
      completedAt: new Date(),
      ...(opts.reviewerId
        ? {
            reviewedBy: opts.reviewerId,
            reviewedAt: new Date(),
            reviewNote: opts.reviewNote ?? null,
          }
        : {}),
    };
    const flipped = await tx.refund.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: flipData,
    });
    if (flipped.count === 0) {
      throw new ConflictException({
        code: 'E-REFUND-004',
        message: `Refund is no longer pending (concurrent review or status changed, read as ${refund.status})`,
      });
    }
    // updateMany 不回传记录：用同事务已读快照 + 写入字段合成（回滚守卫/审计需要 items 与状态一致）
    const updated = { ...refund, ...flipData };

    // 2. 销量回滚（guard：仅曾累加过的订单）
    //    - 预付：markPaidTx 置 paymentStatus=PAID 时累加过
    //    - COD：paymentStatus 全程 PENDING，以收款成功记录（PAID/SHORT）为准
    let salesCounted = order.paymentStatus === 'PAID';
    if (!salesCounted && order.paymentMethod === 'COD') {
      const cash = await tx.cashCollection.findFirst({
        where: { orderId: refund.orderId, result: { in: ['PAID', 'SHORT'] } },
        select: { id: true },
      });
      salesCounted = !!cash;
    }

    if (salesCounted) {
      const operatorId = opts.reviewerId ?? refund.userId;
      if (refund.items.length > 0) {
        // 部分退款：按 RefundItem 递减
        await rollbackSalesCountForRefundItems(
          tx,
          refund.orderId,
          refund.items.map((i) => ({ skuId: i.skuId, refundQty: i.refundQty })),
          { operatorId },
        );
      } else {
        // 整单退款：按 OrderItem 剩余未回滚数量递减
        await rollbackSalesCountForFullOrder(tx, refund.orderId, { operatorId });
      }
    }

    // 3. D8（方案v3 20261012，P2-1 修复）：退款负向调整 Settlement —— 同事务原子
    //    按 completedAt 归属当期 Dili 结算期间（新建负向调整行 / 冲减当期行），
    //    commission clamp ≥ 0，不改写历史已生成 Settlement。
    //    依赖：order 快照须含 warehouse.shopId（上方 select 已带，MVP 单商家）；
    //    subjectId = shopId 与 RealOrderAggregator.aggregateMerchant 归属口径一致
    await applyRefundSettlementAdjustment(
      tx,
      refund.amount,
      updated.completedAt as Date,
      order.warehouse.shopId,
    );

    logger.info({
      msg: 'REFUND_COMPLETED_TX',
      refundId,
      orderId: refund.orderId,
      amount: refund.amount,
      salesCountRolledBack: salesCounted,
      reviewerId: opts.reviewerId ?? null,
    });

    return updated;
  }

  /**
   * 商家审核退款（APPROVE / REJECT）
   */
  async reviewRefund(
    refundId: string,
    reviewerId: string,
    action: 'APPROVE' | 'REJECT',
    reviewNote?: string,
  ): Promise<RefundView> {
    const refund = await db.refund.findUnique({ where: { id: refundId } });
    if (!refund) {
      throw new NotFoundException({
        code: 'E-REFUND-003',
        message: `Refund not found: ${refundId}`,
      });
    }

    if (refund.status !== 'PENDING') {
      throw new ConflictException({
        code: 'E-REFUND-004',
        message: `Refund status ${refund.status} cannot be reviewed`,
      });
    }

    if (action === 'REJECT' && !reviewNote) {
      throw new ConflictException({
        code: 'E-COMMON-001',
        message: 'reviewNote required when rejecting',
      });
    }

    if (action === 'APPROVE') {
      // P2 修复（W5 审查 #3）：金额断言 — 防 DB 篡改导致 0 元退款或超额退款
      // createRefund 内部已设 amount = order.payableAmount，正常流程下必相等
      // 此处复核防 DB 直改/数据损坏
      const order = await db.order.findUnique({
        where: { id: refund.orderId },
        select: { payableAmount: true, status: true },
      });
      if (!order) {
        // 订单被删（极少见，外键约束应防住）— 阻断审核
        throw new NotFoundException({
          code: 'E-REFUND-005',
          message: `Order not found for refund: ${refund.orderId}`,
        });
      }
      if (refund.amount <= 0) {
        logger.error({
          msg: 'REFUND_AMOUNT_INVALID_ZERO_OR_NEGATIVE',
          refundId,
          orderId: refund.orderId,
          amount: refund.amount,
          reviewerId,
        });
        throw new ConflictException({
          code: 'E-REFUND-006',
          message: `Refund amount invalid (amount=${refund.amount}), expected > 0`,
        });
      }
      // P13：放宽强制全额校验（部分退款上线后 amount 可 < payableAmount）
      // 二次防御：只校验 amount > payableAmount（createRefund 入口已校验，此处防 DB 直改）
      if (refund.amount > order.payableAmount) {
        logger.error({
          msg: 'REFUND_AMOUNT_EXCEEDS_ORDER_PAYABLE',
          refundId,
          orderId: refund.orderId,
          refundAmount: refund.amount,
          orderPayableAmount: order.payableAmount,
          reviewerId,
        });
        throw new ConflictException({
          code: 'E-REFUND-010',
          message: `Refund amount ${refund.amount} exceeds order payable ${order.payableAmount}`,
        });
      }

      // 通过 → mock 原路回款 → COMPLETED（批A：经 completeRefundTx 单点，销量回滚同事务）
      const updated = await withTransaction((tx) =>
        this.completeRefundTx(tx, refundId, { reviewerId, reviewNote: reviewNote ?? null }),
      );

      logger.info({
        msg: 'REFUND_APPROVED_AND_COMPLETED',
        refundId,
        orderId: refund.orderId,
        amount: refund.amount,
        reviewerId,
      });

      // P14 ④：RETURN_REFUND 触发建 return task（决策 2 选 A 同步触发，决策 3 复用抢单大厅）
      if (refund.refundType === 'RETURN_REFUND') {
        try {
          const dispatchService = this.moduleRef.get(DispatchService, { strict: false });
          if (dispatchService) {
            await dispatchService.createTaskForReturn(refundId);
            logger.info({
              msg: 'REFUND_RETURN_TASK_TRIGGERED',
              refundId,
              orderId: refund.orderId,
            });
          } else {
            logger.error({
              msg: 'REFUND_DISPATCH_SERVICE_NULL',
              refundId,
              orderId: refund.orderId,
            });
          }
        } catch (e) {
          // 不阻塞 refund 返回（return task 创建失败需人工介入，refund 已 COMPLETED）
          logger.error({
            msg: 'REFUND_RETURN_TASK_TRIGGER_FAILED',
            refundId,
            orderId: refund.orderId,
            error: (e as Error).message,
          });
        }
      }

      return this.toView(updated);
    } else {
      // 驳回
      const updated = await db.refund.update({
        where: { id: refundId },
        data: {
          status: 'REJECTED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: reviewNote!,
        },
        include: { items: true },
      });

      logger.info({
        msg: 'REFUND_REJECTED',
        refundId,
        orderId: refund.orderId,
        reviewerId,
        reviewNote,
      });

      return this.toView(updated);
    }
  }

  /**
   * 客户撤回退款申请（仅 PENDING 可撤）
   */
  async cancelRefund(refundId: string, userId: string): Promise<RefundView> {
    const refund = await db.refund.findUnique({ where: { id: refundId } });
    if (!refund) {
      throw new NotFoundException({
        code: 'E-REFUND-003',
        message: `Refund not found: ${refundId}`,
      });
    }

    if (refund.userId !== userId) {
      throw new ForbiddenException({
        code: 'E-AUTH-012',
        message: 'Refund does not belong to this user',
      });
    }

    if (refund.status !== 'PENDING') {
      throw new ConflictException({
        code: 'E-REFUND-004',
        message: `Refund status ${refund.status} cannot be cancelled`,
      });
    }

    const updated = await db.refund.update({
      where: { id: refundId },
      data: { status: 'CANCELLED' },
      include: { items: true },
    });

    return this.toView(updated);
  }

  /**
   * 查询退款列表（客户视角）
   */
  async listUserRefunds(userId: string): Promise<RefundView[]> {
    const refunds = await db.refund.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
    return refunds.map((r) => this.toView(r));
  }

  /**
   * 查询退款详情
   *
   * @param userId 客户端视角传登录用户 id 做归属校验（非本人抛 E-AUTH-012，对齐 cancelRefund 先例）；
   *               admin 视角传 null 跳过归属校验（admin 端点已有 Roles 门禁）
   */
  async getRefundDetail(refundId: string, userId?: string | null): Promise<RefundView> {
    const refund = await db.refund.findUnique({
      where: { id: refundId },
      include: { items: true },
    });
    if (!refund) {
      throw new NotFoundException({
        code: 'E-REFUND-003',
        message: `Refund not found: ${refundId}`,
      });
    }
    if (userId && refund.userId !== userId) {
      throw new ForbiddenException({
        code: 'E-AUTH-012',
        message: 'Refund does not belong to this user',
      });
    }
    return this.toView(refund);
  }

  /**
   * admin 查询退款列表（可按 status 筛选 + 游标分页）
   *
   * 游标 = 上一页最后一条 refund.id；take: limit+1 探测 hasMore。
   * 与 order.service.ts listAllOrders 同一游标模式（批次 2.1 改造）。
   */
  async listAllRefunds(options: {
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: RefundView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 50, 100);
    const where: Prisma.RefundWhereInput = options.status ? { status: options.status } : {};
    const refunds = await db.refund.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      include: { items: true },
    });
    const hasMore = refunds.length > limit;
    const items = hasMore ? refunds.slice(0, limit) : refunds;
    return {
      items: items.map((r) => this.toView(r)),
      nextCursor: hasMore ? items[items.length - 1].id : null,
      hasMore,
    };
  }

  // === private ===

  private generateMockTransactionId(): string {
    return `MOCK_REFUND_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private toView(r: {
    id: string;
    orderId: string;
    userId: string;
    amount: number;
    reason: string;
    reasonDetail: string | null;
    status: string;
    transactionId: string | null;
    refundMethod: string;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    reviewNote: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    photos: string[];
    refundType: string;
    pickupAt: Date | null;
    pickedAt: Date | null;
    items?: {
      id: string;
      refundId: string;
      orderItemId: string;
      skuId: string;
      productName: unknown;
      unitPrice: number;
      refundQty: number;
      subtotal: number;
    }[];
  }): RefundView {
    return {
      id: r.id,
      orderId: r.orderId,
      userId: r.userId,
      amount: r.amount,
      reason: r.reason,
      reasonDetail: r.reasonDetail,
      status: r.status,
      transactionId: r.transactionId,
      refundMethod: r.refundMethod,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewNote: r.reviewNote,
      completedAt: r.completedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      photos: r.photos ?? [],
      refundType: r.refundType ?? 'REFUND_ONLY',
      pickupAt: r.pickupAt?.toISOString() ?? null,
      pickedAt: r.pickedAt?.toISOString() ?? null,
      items: (r.items ?? []).map((it) => ({
        id: it.id,
        refundId: it.refundId,
        orderItemId: it.orderItemId,
        skuId: it.skuId,
        productName: (it.productName ?? {}) as Record<string, string>,
        unitPrice: it.unitPrice,
        refundQty: it.refundQty,
        subtotal: it.subtotal,
      })),
    };
  }
}
