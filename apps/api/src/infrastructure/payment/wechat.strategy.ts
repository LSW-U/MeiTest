/**
 * 微信支付策略 — Mock 实现
 *
 * 决策依据：CLAUDE.md §测试阶段支付方案
 *   - 测试阶段：直接返回 PROCESSING + MOCK_transactionId
 *   - queryPayment 模拟 5 秒延迟后 PAID（让前端能测出 PROCESSING 状态）
 *   - W6-W7：挂靠国内个体户后切真实商户号（接口不变）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [MOCK_WECHAT]，便于排查
 */
import { genId } from '@meimart/shared-utils';
import { logger } from "../../shared/logger/logger";
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

const MOCK_TAG = '[MOCK_WECHAT]';
const PROCESSING_DELAY_SECONDS = 5; // 模拟用户从 PROCESSING 到 PAID 的延迟
const MOCK_KEY_PREFIX = 'mock:wechat:';

export class WechatStrategy implements PaymentStrategy {
  readonly method = 'WECHAT' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const mockTransactionId = `MOCK_${genId()}`;
    // Redis 记录创建时间戳，queryPayment 时判断是否已过延迟窗口
    await redis.set(
      `${MOCK_KEY_PREFIX}${mockTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );

    logger.info(
      `${MOCK_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${mockTransactionId} (PROCESSING → PAID after ${PROCESSING_DELAY_SECONDS}s)`,
    );

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'WECHAT',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: mockTransactionId,
      clientSecret: `mock_wechat_secret_${input.orderNo}`,
      mockFlag: true,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    const createdAtStr = await redis.get(`${MOCK_KEY_PREFIX}${input.transactionId}`);
    const elapsed = createdAtStr ? (Date.now() - Number(createdAtStr)) / 1000 : Infinity;

    if (elapsed >= PROCESSING_DELAY_SECONDS) {
      logger.info(`${MOCK_TAG} queryPayment transactionId=${input.transactionId} → PAID (after ${elapsed.toFixed(1)}s)`);
      return {
        transactionId: input.transactionId,
        status: 'PAID',
        paidAt: new Date().toISOString(),
        providerPayload: { mock: true, simulated_at: new Date().toISOString() },
      };
    }

    logger.info(`${MOCK_TAG} queryPayment transactionId=${input.transactionId} → PROCESSING (${elapsed.toFixed(1)}s / ${PROCESSING_DELAY_SECONDS}s)`);
    return {
      transactionId: input.transactionId,
      status: 'PROCESSING',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `MOCK_REFUND_${genId()}`;
    logger.info(`${MOCK_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, mock 异步)`);
    // 真实第三方退款是异步，mock 返回 PENDING 让前端能测出"退款进行中"UI
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
