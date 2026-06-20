/**
 * Stripe 支付策略 — Stub 实现
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案
 *   - 测试阶段：返回明显假的 clientSecret（STUB_STRIPE_SECRET_xxx，避开真实 Stripe 格式 pi_xxx_secret_xxx）
 *   - queryPayment 模拟 5 秒延迟后 PAID
 *   - refund 返回 PENDING 模拟异步
 *   - W6-W7：Stripe Atlas LLC 后接真实 Stripe（接口不变）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [STUB_STRIPE]
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

const STUB_TAG = '[STUB_STRIPE]';
const PROCESSING_DELAY_SECONDS = 5;
const STUB_KEY_PREFIX = 'stub:stripe:';

export class StripeStrategy implements PaymentStrategy {
  readonly method = 'STRIPE' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_STRIPE_${genId()}`;
    await redis.set(
      `${STUB_KEY_PREFIX}${stubTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );
    // 明显假的 secret 格式，避免前端 Stripe SDK 正则误判
    const clientSecret = `STUB_STRIPE_SECRET_${input.orderNo}_${genId().slice(0, 8)}`;

    console.log(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId}`);

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'STRIPE',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret,
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
    const refundId = `STUB_STRIPE_REFUND_${genId()}`;
    console.log(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, stub 异步)`);
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
