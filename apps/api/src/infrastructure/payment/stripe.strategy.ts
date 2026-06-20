/**
 * Stripe 支付策略 — Stub 实现
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案
 *   - 测试阶段：返回 mock client_secret（前端 Stripe SDK 用假参数）
 *   - W6-W7：Stripe Atlas LLC 后接真实 Stripe（接口不变）
 *
 * 日志标 [STUB]
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

const STUB_TAG = '[STUB_STRIPE]';

export class StripeStrategy implements PaymentStrategy {
  readonly method = 'STRIPE' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_STRIPE_${uuidv4()}`;
    const clientSecret = `pi_STUB_${input.orderNo}_secret_${uuidv4().slice(0, 12)}`;
    console.log(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId}`);

    return {
      id: uuidv4(),
      orderId: input.orderId,
      method: 'STRIPE',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret, // Stripe PaymentIntent client_secret 格式
      mockFlag: true,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    console.log(`${STUB_TAG} queryPayment transactionId=${input.transactionId} → PAID (stub)`);
    return {
      transactionId: input.transactionId,
      status: 'PAID',
      providerPayload: { stub: true, simulated_at: new Date().toISOString() },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `STUB_STRIPE_REFUND_${uuidv4()}`;
    console.log(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId}`);
    return {
      refundTransactionId: refundId,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
