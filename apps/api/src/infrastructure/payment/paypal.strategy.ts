/**
 * PayPal 支付策略 — Stub 实现
 *
 * 决策依据：CLAUME.md §测试阶段支付方案
 *   - 测试阶段：返回 mock PayPal checkout URL（前端打开假页面）
 *   - W6-W7：Stripe Atlas 美国 LLC 后接 PayPal Business（接口不变）
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

const STUB_TAG = '[STUB_PAYPAL]';

export class PaypalStrategy implements PaymentStrategy {
  readonly method = 'PAYPAL' as const;
  readonly isMock = true; // stub 也是 mock 的一种

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_PAYPAL_${uuidv4()}`;
    const checkoutUrl = `https://www.sandbox.paypal.com/checkoutnow?token=STUB_${input.orderNo}`;
    console.log(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId}`);

    return {
      id: uuidv4(),
      orderId: input.orderId,
      method: 'PAYPAL',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret: checkoutUrl, // clientSecret 字段复用，放 PayPal redirect URL
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
    const refundId = `STUB_PAYPAL_REFUND_${uuidv4()}`;
    console.log(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId}`);
    return {
      refundTransactionId: refundId,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
