/**
 * 银行转账支付策略 — 真实流程（凭证上传 + 人工对账）
 *
 * 决策依据：契约 v0.3 决策 D + CLAUDE.md §测试阶段支付方案
 *   - 客户转账后上传凭证到 OSS
 *   - 后端存凭证 URL（PaymentIntent.receiptUrl），PaymentIntent.status=PENDING
 *   - admin-web 仓库视角手动确认 → 订单进 CONFIRMED
 *
 * 注意：createPayment 只构造 PaymentIntent 对象，调用方负责持久化
 *      BANK_TRANSFER 无第三方，不实现 queryPayment（P1-#2 optional 化）
 */
import { genId } from '@meimart/shared-utils';
import type {
  PaymentStrategy,
  CreatePaymentInput,
  PaymentIntent,
  RefundInput,
  RefundResult,
} from './payment-strategy';

export class BankTransferStrategy implements PaymentStrategy {
  readonly method = 'BANK_TRANSFER' as const;
  readonly isMock = false;

  async createPayment(input: CreatePaymentInput): Promise<PaymentIntent> {
    return {
      id: genId(),
      orderId: input.orderId,
      method: 'BANK_TRANSFER',
      status: 'PENDING', // 等用户上传凭证 + admin 确认
      amount: input.amount,
      transactionId: `BANK_${input.orderNo}`,
      mockFlag: false,
      createdAt: new Date().toISOString(),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // 线下退款（手工打款回原账户），系统记流水
    return {
      refundTransactionId: `BANK_REFUND_${genId()}`,
      status: 'SUCCESS',
      amount: input.amount,
    };
  }
}
