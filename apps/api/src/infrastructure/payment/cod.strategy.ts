/**
 * COD 支付策略（货到付款）— 真实流程
 *
 * 决策依据：契约 v0.3 决策 D + CLAUDE.md §测试阶段支付方案
 *   - 客户不预付
 *   - 骑手送达时收款（CashCollection 表，骑手调用 /rider/orders/:orderId/collect-cash）
 *   - 订单状态机：DELIVERED_PAID（成功） / DELIVERED_UNPAID（拒付）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化（D4+ 各流程接入时 DB PaymentIntent 写入）
 *      COD 无第三方支付，不实现 queryPayment（P1-#2 optional 化）
 */
import { genId } from '@meimart/shared-utils';
import type {
  PaymentStrategy,
  CreatePaymentInput,
  PaymentIntent,
  RefundInput,
  RefundResult,
} from './payment-strategy';

export class CodStrategy implements PaymentStrategy {
  readonly method = 'COD' as const;
  readonly isMock = false;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    // COD 无第三方流水号，用 orderNo 派生可读标识
    return {
      id: genId(),
      orderId: input.orderId,
      method: 'COD',
      status: 'PENDING',
      amount: input.amount,
      transactionId: `COD_${input.orderNo}`,
      mockFlag: false,
      createdAt: new Date().toISOString(),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // COD 退款线下操作（骑手已收现金 → 商家手工退），系统只记流水
    return {
      refundTransactionId: `COD_REFUND_${genId()}`,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
