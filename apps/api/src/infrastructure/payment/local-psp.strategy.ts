/**
 * 东帝汶本地支付服务商策略 — Stub 实现（批B 枚举补位，微信支付预留 2026-09-08，方案V2 §3.2）
 *
 * 决策依据：
 * - 本地 PSP（Timor Telecom / Telkomcel 电子钱包、本地收单机构）需准入资质 + 银行账户（C6，合规清单挂账）
 * - config available=false：列表可见"即将上线"，createOrder 服务端拒绝（R2）；
 *   本 stub 仅保证工厂注册完整性（PaymentProvider 抽象，W6 后调研接入时零结构改动）
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 * 日志标 [STUB_LOCAL_PSP]
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

const STUB_TAG = '[STUB_LOCAL_PSP]';
const PROCESSING_DELAY_SECONDS = 5;
const STUB_KEY_PREFIX = 'stub:local-psp:';

export class LocalPspStrategy implements PaymentStrategy {
  readonly method = 'LOCAL_PSP' as const;
  readonly isMock = true;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    const stubTransactionId = `STUB_LOCAL_PSP_${genId()}`;
    await redis.set(
      `${STUB_KEY_PREFIX}${stubTransactionId}`,
      Date.now().toString(),
      'EX',
      10 * 60,
    );

    logger.info(`${STUB_TAG} createPayment orderNo=${input.orderNo} amount=${input.amount} → ${stubTransactionId} (reserved, pending local PSP qualification)`);

    return {
      id: genId(),
      orderId: input.orderId,
      method: 'LOCAL_PSP',
      status: 'PROCESSING',
      amount: input.amount,
      transactionId: stubTransactionId,
      clientSecret: `stub_local_psp_secret_${input.orderNo}`,
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
    const refundId = `STUB_LOCAL_PSP_REFUND_${genId()}`;
    logger.info(`${STUB_TAG} refund transactionId=${input.transactionId} amount=${input.amount} → ${refundId} (PENDING, stub 异步)`);
    return {
      refundTransactionId: refundId,
      status: 'PENDING',
      amount: input.amount,
    };
  }
}
