/**
 * 微信支付策略 — Mock 实现
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案
 *   - 测试阶段：直接返回 success + MOCK_transactionId，前端跳转"支付成功"页
 *   - W6-W7：挂靠国内个体户后切真实商户号（接口不变）
 *
 * 日志标 [MOCK]，便于排查
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

const MOCK_TAG = '[MOCK_WECHAT]';

export class WechatStrategy implements PaymentStrategy {
  readonly method = 'WECHAT' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const mockTransactionId = `MOCK_${uuidv4()}`;
    console.log(`${MOCK_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${mockTransactionId}`);

    return {
      id: uuidv4(),
      orderId: input.orderId,
      method: 'WECHAT',
      status: 'PROCESSING', // mock 模拟用户进入支付页
      amount: input.amount,
      transactionId: mockTransactionId,
      clientSecret: `mock_wechat_secret_${input.orderNo}`, // mock 给前端的 SDK 参数
      mockFlag: true,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    console.log(`${MOCK_TAG} queryPayment transactionId=${input.transactionId} → PAID (mock)`);
    return {
      transactionId: input.transactionId,
      status: 'PAID', // mock 直接返回已支付
      providerPayload: { mock: true, simulated_at: new Date().toISOString() },
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `MOCK_REFUND_${uuidv4()}`;
    console.log(`${MOCK_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId}`);
    return {
      refundTransactionId: refundId,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
