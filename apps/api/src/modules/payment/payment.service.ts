/**
 * Payment Service — 业务层
 *
 * 决策依据：
 * - W1 已封装 infrastructure/payment 的 5 策略（COD/BANK 真实 + WECHAT/PAYPAL/STRIPE mock/stub）
 * - 本模块职责：把 strategy 接入业务流程，持久化 PaymentIntent + 状态流转
 * - mock/stub 模式：dev/staging 时 mockCallback 直接置 PAID，prod 时只有真实回调能改状态
 *
 * 核心方法：
 *   - createIntentForOrder: 下单后调用，调 strategy.createPayment 持久化 PaymentIntent
 *   - getIntentByOrder: 查询 PaymentIntent（前端展示支付状态 + mock 标识）
 *   - mockCallback: dev/staging 模拟第三方支付成功（仅 WECHAT/PAYPAL/STRIPE）
 *   - uploadReceipt: 银行转账上传凭证（BANK_TRANSFER 专用）
 *
 * 与 OrderService 解耦：
 *   - OrderService 在事务后调用 createIntentForOrder
 *   - 支付成功后调 OrderService.markPaid（在 OrderModule 内由 controller 编排）
 */
import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import {
  getPaymentStrategy,
  type PaymentIntent as StrategyPaymentIntent,
  type PaymentMethodCode,
} from '../../infrastructure';
import type { PaymentMethodValue } from '../order/order.types';

/** createIntentForOrder 入参 */
export interface CreateIntentInput {
  orderId: string;
  orderNo: string;
  amount: number;
  method: PaymentMethodValue;
}

/** createIntentForOrder 出参（OrderService 拼到 CreatedOrder.paymentClientSecret） */
export interface CreatedIntent {
  intentId: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  clientSecret?: string;
  mockFlag: boolean;
}

/** PaymentIntent 业务视图（API 返回用） */
export interface PaymentIntentView {
  id: string;
  orderId: string;
  method: PaymentMethodValue;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amount: number;
  transactionId: string | null;
  clientSecret: string | null;
  receiptUrl: string | null;
  mockFlag: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payment Service — 应用层
 *
 * DI 注入方式：用字符串 token 'PaymentServiceToken' 解 OrderService ↔ PaymentService 循环依赖
 * （PaymentModule 不需反向调 OrderService，仅 controller 层编排）
 */
@Injectable()
export class PaymentService {
  /**
   * 为订单创建 PaymentIntent（事务后调用，不在 Order 事务内）
   *
   * 注意：返回的 StrategyPaymentIntent.id 是 strategy 生成的临时 id（uuid），
   *       持久化到 DB 时用其作为 PaymentIntent.id（与 strategy 完全对齐，便于 mock callback 反查）
   */
  async createIntentForOrder(input: CreateIntentInput): Promise<CreatedIntent> {
    // 已有 PaymentIntent 视为幂等返回（避免重复下单时重创建）
    const existing = await db.paymentIntent.findUnique({ where: { orderId: input.orderId } });
    if (existing) {
      return {
        intentId: existing.id,
        status: existing.status,
        clientSecret: undefined,
        mockFlag: existing.mockFlag,
      };
    }

    const strategy = getPaymentStrategy(input.method as PaymentMethodCode);
    const strategyIntent: StrategyPaymentIntent = await strategy.createPayment({
      orderId: input.orderId,
      orderNo: input.orderNo,
      amount: input.amount,
      paymentMethod: input.method as PaymentMethodCode,
    });

    const created = await db.paymentIntent.create({
      data: {
        id: strategyIntent.id,
        orderId: input.orderId,
        method: input.method,
        status: strategyIntent.status === 'PAID' ? 'PAID' : 'PENDING',
        amount: strategyIntent.amount,
        transactionId: strategyIntent.transactionId ?? null,
        mockFlag: strategyIntent.mockFlag,
        receiptUrl: strategyIntent.receiptUrl ?? null,
        providerPayload: (strategyIntent.providerPayload as object) ?? null,
        paidAt: strategyIntent.paidAt ? new Date(strategyIntent.paidAt) : null,
      },
    });

    logger.info({
      msg: 'PAYMENT_INTENT_CREATED',
      intentId: created.id,
      orderId: input.orderId,
      orderNo: input.orderNo,
      method: input.method,
      amount: input.amount,
      mockFlag: created.mockFlag,
    });

    return {
      intentId: created.id,
      status: created.status,
      // clientSecret 仅第三方预付场景存在（strategy 在 clientSecret 字段填）
      // 当前 5 策略都是 mock/stub/COD/BANK，未真正填 clientSecret，统一 undefined
      clientSecret: strategyIntent.clientSecret,
      mockFlag: created.mockFlag,
    };
  }

  /**
   * 查询 PaymentIntent（按 orderId）
   */
  async getIntentByOrder(orderId: string): Promise<PaymentIntentView> {
    const intent = await db.paymentIntent.findUnique({ where: { orderId } });
    if (!intent) {
      throw new NotFoundException({
        code: 'E-PAYMENT-005',
        message: 'Payment intent not found',
      });
    }
    return this.toView(intent);
  }

  /**
   * dev/staging mock 回调（模拟第三方支付成功）
   *
   * 仅允许：
   *   - method ∈ {WECHAT, PAYPAL, STRIPE}（预付 + mock/stub 模式）
   *   - 原状态为 PENDING / PROCESSING
   *   - NODE_ENV !== 'production'（prod 必须真实回调）
   *
   * @returns orderId（让 controller 编排 OrderService.markPaid）
   */
  async mockCallback(orderId: string): Promise<{ orderId: string; intentId: string }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ConflictException({
        code: 'E-PAYMENT-006',
        message: 'Mock callback disabled in production',
      });
    }

    const intent = await db.paymentIntent.findUnique({ where: { orderId } });
    if (!intent) {
      throw new NotFoundException({
        code: 'E-PAYMENT-005',
        message: 'Payment intent not found',
      });
    }

    if (!['WECHAT', 'PAYPAL', 'STRIPE'].includes(intent.method)) {
      throw new ConflictException({
        code: 'E-PAYMENT-007',
        message: `Mock callback only available for WECHAT/PAYPAL/STRIPE, got ${intent.method}`,
      });
    }

    if (intent.status === 'PAID') {
      // 幂等：已支付直接返回（不重复 markPaid）
      return { orderId: intent.orderId, intentId: intent.id };
    }

    if (intent.status !== 'PENDING' && intent.status !== 'PROCESSING') {
      throw new ConflictException({
        code: 'E-PAYMENT-008',
        message: `Payment intent status ${intent.status} cannot receive mock callback`,
      });
    }

    const updated = await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        providerPayload: {
          ...(intent.providerPayload as object | null),
          mockCallbackAt: new Date().toISOString(),
          mock: true,
        },
      },
    });

    logger.warn({
      msg: 'MOCK_PAYMENT_CALLBACK',
      intentId: updated.id,
      orderId,
      method: intent.method,
      amount: intent.amount,
      note: 'PROD MUST DISABLE — only dev/staging allowed',
    });

    return { orderId: updated.orderId, intentId: updated.id };
  }

  /**
   * 银行转账凭证上传（BANK_TRANSFER 专用）
   *
   * W2 阶段：仅更新 receiptUrl，不变更 status（status 由 admin 仓库视角审核后改 PAID）
   */
  async uploadReceipt(orderId: string, receiptUrl: string): Promise<PaymentIntentView> {
    const intent = await db.paymentIntent.findUnique({ where: { orderId } });
    if (!intent) {
      throw new NotFoundException({
        code: 'E-PAYMENT-005',
        message: 'Payment intent not found',
      });
    }
    if (intent.method !== 'BANK_TRANSFER') {
      throw new ConflictException({
        code: 'E-PAYMENT-009',
        message: `Receipt upload only available for BANK_TRANSFER, got ${intent.method}`,
      });
    }

    const updated = await db.paymentIntent.update({
      where: { id: intent.id },
      data: { receiptUrl, status: 'PROCESSING' }, // 标 PROCESSING 等仓库审核
    });

    logger.info({
      msg: 'PAYMENT_RECEIPT_UPLOADED',
      intentId: intent.id,
      orderId,
      receiptUrl,
    });

    return this.toView(updated);
  }

  /**
   * 标 PaymentIntent 为 PAID（admin 审核通过银行转账时调）
   *
   * 注意：不在此触发 OrderService.markPaid，由 controller 编排
   */
  async markPaidByAdmin(orderId: string, adminUserId: string): Promise<PaymentIntentView> {
    const intent = await db.paymentIntent.findUnique({ where: { orderId } });
    if (!intent) {
      throw new NotFoundException({
        code: 'E-PAYMENT-005',
        message: 'Payment intent not found',
      });
    }
    if (intent.status === 'PAID') {
      return this.toView(intent);
    }

    const updated = await db.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        providerPayload: {
          ...(intent.providerPayload as object | null),
          confirmedByAdmin: adminUserId,
          confirmedAt: new Date().toISOString(),
        },
      },
    });

    logger.info({
      msg: 'PAYMENT_ADMIN_CONFIRMED',
      intentId: intent.id,
      orderId,
      adminUserId,
    });

    return this.toView(updated);
  }

  /** DB PaymentIntent → API view */
  private toView(intent: {
    id: string;
    orderId: string;
    method: PaymentMethodValue;
    status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
    amount: number;
    transactionId: string | null;
    mockFlag: boolean;
    receiptUrl: string | null;
    paidAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentIntentView {
    return {
      id: intent.id,
      orderId: intent.orderId,
      method: intent.method,
      status: intent.status,
      amount: intent.amount,
      transactionId: intent.transactionId,
      clientSecret: null,
      receiptUrl: intent.receiptUrl,
      mockFlag: intent.mockFlag,
      paidAt: intent.paidAt ? intent.paidAt.toISOString() : null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    };
  }
}

/** DI token（解 Order ↔ Payment 循环依赖） */
export const PAYMENT_SERVICE_TOKEN = 'PaymentServiceToken';
