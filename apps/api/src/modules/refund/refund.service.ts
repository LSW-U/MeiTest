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
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { OrderService } from '../order/order.service';
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
}

@Injectable()
export class RefundService {
  constructor(@Inject(ModuleRef) private readonly moduleRef: ModuleRef) {}

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
      amount = 0;
      for (const ri of input.items) {
        const oi = order.items.find((x) => x.id === ri.orderItemId);
        if (!oi) {
          throw new ConflictException({
            code: 'E-REFUND-008',
            message: `OrderItem not found in this order: ${ri.orderItemId}`,
          });
        }
        if (ri.refundQty > oi.quantity) {
          throw new ConflictException({
            code: 'E-REFUND-009',
            message: `refundQty (${ri.refundQty}) exceeds item quantity (${oi.quantity})`,
          });
        }
        const subtotal = oi.unitPrice * ri.refundQty;
        amount += subtotal;
        refundItemsData.push({ orderItemId: ri.orderItemId, refundQty: ri.refundQty, subtotal });
      }
    } else {
      amount = order.payableAmount;
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

    const refund = await db.refund.create({
      data: {
        orderId: input.orderId,
        userId: input.userId,
        amount,
        reason: input.reason,
        reasonDetail: input.reasonDetail ?? null,
        status: autoApprove ? 'COMPLETED' : 'PENDING',
        refundMethod,
        transactionId: autoApprove ? this.generateMockTransactionId() : null,
        reviewedBy: autoApprove ? null : null,
        completedAt: autoApprove ? new Date() : null,
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

      // 通过 → mock 原路回款 → COMPLETED
      const updated = await db.refund.update({
        where: { id: refundId },
        data: {
          status: 'COMPLETED',
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: reviewNote ?? null,
          transactionId: this.generateMockTransactionId(),
          completedAt: new Date(),
        },
        include: { items: true },
      });

      logger.info({
        msg: 'REFUND_APPROVED_AND_COMPLETED',
        refundId,
        orderId: refund.orderId,
        amount: refund.amount,
        reviewerId,
      });

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
   * admin 查询退款列表（可按 status 筛选）
   */
  async listAllRefunds(status?: string): Promise<RefundView[]> {
    const refunds = await db.refund.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { items: true },
    });
    return refunds.map((r) => this.toView(r));
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
