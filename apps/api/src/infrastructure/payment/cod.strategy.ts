/**
 * COD 支付策略（货到付款）— 真实流程
 *
 * 决策依据：契约 v0.3 决策 D + CLAUDE.md §测试阶段支付方案
 *   - 客户不预付
 *   - 骑手送达时收款（CashCollection 表，骑手调用 /rider/orders/:orderId/collect-cash）
 *   - 订单状态机：DELIVERED_PAID（成功） / DELIVERED_UNPAID（拒付）
 *
 * createPayment 实际只是创建 PaymentIntent 记录（status=PENDING），等骑手收款
 */
import { v4 as uuidv4 } from 'uuid';
import type {
  PaymentStrategy,
  CreatePaymentInput,
  PaymentIntent,
  QueryPaymentInput,
  PaymentStatusResult,
  RefundInput,
  RefundResult,
} from './payment-strategy';

export class CodStrategy implements PaymentStrategy {
  readonly method = 'COD' as const;
  readonly isMock = false;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    // COD 无第三方流水号，用本地 ID 标识
    return {
      id: uuidv4(),
      orderId: input.orderId,
      method: 'COD',
      status: 'PENDING',
      amount: input.amount,
      transactionId: `COD_${input.orderNo}`,
      mockFlag: false,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    // COD 状态由骑手 collect-cash 端点更新，这里返回 PENDING（实际从 DB PaymentIntent 读）
    return {
      transactionId: input.transactionId,
      status: 'PENDING',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // COD 退款线下操作（骑手已收现金 → 商家手工退），系统只记流水
    return {
      refundTransactionId: `COD_REFUND_${uuidv4()}`,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
