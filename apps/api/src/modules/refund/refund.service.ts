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
} from '../../shared/db';
import type { Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { OrderService } from '../order/order.service';
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

    // 校验是否已有进行中的退款
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
        return this.completeRefundTx(tx, created.id, { reviewerId: null, reviewNote: null });
      }
      return created;
    });

    // 自动通过时同步取消订单 + 释放库存
    if (autoApprove) {
      // P0 修复：接单前退款必须同步取消订单 + 释放库存
      // 动态注入 OrderService（避免循环依赖，复用 W3 的 ModuleRef token 注入模式）
      try {
        const orderService = this.moduleRef.get(OrderService, { strict: false });

        if (!orderService) {
          logger.error({
            msg: 'REFUND_AUTO_APPROVE_ORDER_SERVICE_NULL',
            refundId: refund.id,
            orderId: input.orderId,
          });
          // OrderService null 不阻塞 refund 返回（但订单状态不一致，需人工介入）
          return this.toView(refund);
        }

        await orderService.cancelOrderInternal(input.orderId, {
          operatorId: order.userId,
          deviceType: 'client_app',
          perspective: 'customer',
          reason: 'REFUND_AUTO_APPROVED',
        });

        logger.info({
          msg: 'REFUND_AUTO_COMPLETED_WITH_ORDER_CANCEL',
          refundId: refund.id,
          orderId: input.orderId,
          amount,
          reason: 'order not yet confirmed, stock released',
        });
      } catch (err) {
        // cancelOrderInternal 失败 → 记录异常，不阻塞 refund 返回（但订单状态不一致）
        logger.error({
          msg: 'REFUND_AUTO_APPROVE_CANCEL_ORDER_FAILED',
          refundId: refund.id,
          orderId: input.orderId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        // 不抛异常，让 refund 正常返回（后续人工介入或脚本修复）
      }
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
      select: { id: true, paymentStatus: true, paymentMethod: true },
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
   */
  async getRefundDetail(refundId: string): Promise<RefundView> {
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
