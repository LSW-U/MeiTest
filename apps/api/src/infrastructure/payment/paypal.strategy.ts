/**
 * PayPal 支付策略 — Stub 实现
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案
 *   - 测试阶段：返回 mock PayPal checkout URL（明显假域名 stub.meimart.local，避免误访问真实 PayPal）
 *   - queryPayment 模拟 5 秒延迟后 PAID
 *   - refund 返回 PENDING 模拟异步
 *   - W6-W7：Stripe Atlas 美国 LLC 后接 PayPal Business（接口不变）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [STUB_PAYPAL]
 */
import { genId } from '@meimart/shared-utils';
import { redis } from '../../shared/cache';
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
const PROCESSING_DELAY_SECONDS = 5;
const STUB_KEY_PREFIX = 'stub:paypal:';

export class PaypalStrategy implements PaymentStrategy {
  readonly method = 'PAYPAL' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_PAYPAL_${genId()}`;
    await redis.set(
      `${STUB_KEY_PREFIX}${stubTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );
    // 用明显的 stub 域名，避免前端误访问真实 PayPal sandbox
    const checkoutUrl = `https://stub.meimart.local/paypal-checkout?token=STUB_${input.orderNo}`;

    console.log(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId}`);

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'PAYPAL',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret: checkoutUrl,
      mockFlag: true,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    const createdAtStr = await redis.get(`${STUB_KEY_PREFIX}${input.transactionId}`);
    const elapsed = createdAtStr ? (Date.now() - Number(createdAtStr)) / 1000 : Infinity;

    if (elapsed >= PROCESSING_DELAY_SECONDS) {
      console.log(`${STUB_TAG} queryPayment transactionId=${input.transactionId} → PAID (after ${elapsed.toFixed(1)}s)`);
      return {
        transactionId: input.transactionId,
        status: 'PAID',
        paidAt: new Date().toISOString(),
        providerPayload: { stub: true, simulated_at: new Date().toISOString() },
      };
    }

    console.log(`${STUB_TAG} queryPayment transactionId=${input.transactionId} → PROCESSING (${elapsed.toFixed(1)}s / ${PROCESSING_DELAY_SECONDS}s)`);
    return {
      transactionId: input.transactionId,
      status: 'PROCESSING',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `STUB_PAYPAL_REFUND_${genId()}`;
    console.log(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, stub 异步)`);
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
