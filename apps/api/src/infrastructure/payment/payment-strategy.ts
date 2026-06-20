/**
 * 支付策略抽象（v0.3 决策 D：5 枚举全预留）
 *
 * 决策依据：
 * - CLAUDE.md §测试阶段支付完整方案 + 契约 v0.3 决策 D
 * - 5 个实现：COD（真实）/ BANK_TRANSFER（真实）/ WECHAT（mock）/ PAYPAL（stub）/ STRIPE（stub）
 * - mock/stub 实现日志标 [MOCK] / [STUB]，便于排查
 *
 * 切换策略只改 .env 的 PAYMENT_STRATEGY，不改代码
 */

export type PaymentMethodCode = 'COD' | 'BANK_TRANSFER' | 'WECHAT' | 'PAYPAL' | 'STRIPE';

export interface CreatePaymentInput {
  orderId: string;
  orderNo: string;
  amount: number; // 整数分
  paymentMethod: PaymentMethodCode;
  /** 客户端回调 URL（预付场景，第三方支付跳转回来用） */
  callbackUrl?: string;
}

export interface PaymentIntent {
  id: string;
  orderId: string;
  method: PaymentMethodCode;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amount: number;
  /** 第三方流水号；mock/stub 标识：MOCK_xxx / STUB_xxx */
  transactionId?: string;
  /** 客户端跳转 URL / SDK 参数（预付场景） */
  clientSecret?: string;
  /** mock/stub 标识（dev 期间为 true，prod 切真后为 false） */
  mockFlag: boolean;
  createdAt: string;
}

export interface QueryPaymentInput {
  transactionId: string;
}

export interface PaymentStatusResult {
  transactionId: string;
  status: PaymentIntent['status'];
  /** 第三方原始 payload（审计） */
  providerPayload?: unknown;
}

export interface RefundInput {
  transactionId: string;
  amount: number; // 整数分，部分退款时小于原金额
  reason?: string;
}

export interface RefundResult {
  refundTransactionId: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  amount: number;
}

/**
 * 支付策略接口（所有支付方式必须实现）
 *
 * 命名：xxxStrategy（与 v0.3 决策文档一致）
 */
export interface PaymentStrategy {
  /** 策略对应的方式 */
  readonly method: PaymentMethodCode;

  /** 创建支付（订单创建后调用） */
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;

  /** 查询支付状态（轮询/对账） */
  queryPayment(input: QueryPaymentInput): Promise<PaymentStatusResult>;

  /** 退款（取消订单 / 售后） */
  refund(input: RefundInput): Promise<RefundResult>;

  /** 是否为 mock/stub 实现（用于日志区分 + W7 上线前 checklist） */
  readonly isMock: boolean;
}
