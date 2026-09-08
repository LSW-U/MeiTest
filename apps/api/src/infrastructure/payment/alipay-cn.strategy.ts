/**
 * 支付宝（中国）策略 — Stub 实现（批B 枚举补位，微信支付预留 2026-09-08，方案V2 §3.2）
 *
 * 决策依据：
 * - 支付宝商户接入需中国主体资质（C5，合规清单挂账），MVP 阶段接口预留
 * - config available=false：列表可见"即将上线"，createOrder 服务端拒绝（R2）；
 *   本 stub 仅保证工厂注册完整性（PaymentProvider 抽象，切真时零结构改动）
 * - W7+：拿到主体资质后切真（接口不变）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [STUB_ALIPAY_CN]
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

const STUB_TAG = '[STUB_ALIPAY_CN]';
const PROCESSING_DELAY_SECONDS = 5;
const STUB_KEY_PREFIX = 'stub:alipay-cn:';

export class AlipayCnStrategy implements PaymentStrategy {
  readonly method = 'ALIPAY_CN' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_ALIPAY_CN_${genId()}`;
    await redis.set(
      `${STUB_KEY_PREFIX}${stubTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );

    logger.info(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId} (reserved, pending CN entity qualification)`);

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'ALIPAY_CN',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret: `stub_alipay_cn_secret_${input.orderNo}`,
      mockFlag: true,
      createdAt: new Date().toISOString(),
    };
  }

  async queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult> {
    const createdAtStr = await redis.get(`${STUB_KEY_PREFIX}${input.transactionId}`);
    const elapsed = createdAtStr ? (Date.now() - Number(createdAtStr)) / 1000 : Infinity;

    if (elapsed >= PROCESSING_DELAY_SECONDS) {
      logger.info(`${STUB_TAG} queryPayment transactionId=${input.transactionId} → PAID (after ${elapsed.toFixed(1)}s)`);
      return {
        transactionId: input.transactionId,
        status: 'PAID',
        paidAt: new Date().toISOString(),
        providerPayload: { stub: true, simulated_at: new Date().toISOString() },
      };
    }

    logger.info(`${STUB_TAG} queryPayment transactionId=${input.transactionId} → PROCESSING (${elapsed.toFixed(1)}s / ${PROCESSING_DELAY_SECONDS}s)`);
    return {
      transactionId: input.transactionId,
      status: 'PROCESSING',
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const refundId = `STUB_ALIPAY_CN_REFUND_${genId()}`;
    logger.info(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, stub 异步)`);
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
