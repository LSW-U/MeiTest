/**
 * 微信支付（国际版）策略 — Stub 实现（批B 枚举补位，微信支付预留 2026-09-08，方案V2 §3.2）
 *
 * 决策依据：
 * - 微信跨境支付 49 国名单不含东帝汶（官方 FAQ，批D 名单核查记录），WECHAT_GLOBAL 仅占位
 * - config available=false：列表可见"即将上线"，createOrder 服务端拒绝（R2）；
 *   本 stub 仅保证工厂注册完整性（PaymentProvider 抽象，切真时零结构改动）
 * - W7+：若东帝汶受理跨境微信再评估切真（接口不变）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [STUB_WECHAT_GLOBAL]
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

const STUB_TAG = '[STUB_WECHAT_GLOBAL]';
const PROCESSING_DELAY_SECONDS = 5;
const STUB_KEY_PREFIX = 'stub:wechat-global:';

export class WechatGlobalStrategy implements PaymentStrategy {
  readonly method = 'WECHAT_GLOBAL' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_WECHAT_GLOBAL_${genId()}`;
    await redis.set(
      `${STUB_KEY_PREFIX}${stubTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );

    logger.info(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId} (placeholder, WECHAT_GLOBAL not accepted in Timor-Leste)`);

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'WECHAT_GLOBAL',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret: `stub_wechat_global_secret_${input.orderNo}`,
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
    const refundId = `STUB_WECHAT_GLOBAL_REFUND_${genId()}`;
    logger.info(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, stub 异步)`);
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
