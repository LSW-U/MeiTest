/**
 * 支付策略抽象（v0.3 决策 D：5 枚举全预留）
 *
 * 决策依据：
 * - CLAUDE.md §测试阶段支付完整方案 + 契约 v0.3 决策 D + 批B 枚举补位（方案V2 §3.2）
 * - 8 个实现：COD（真实）/ BANK_TRANSFER（真实）/ WECHAT（mock）/ PAYPAL（stub）/ STRIPE（stub）
 *   / WECHAT_GLOBAL / ALIPAY_CN / LOCAL_PSP（批B stub 占位，available=false 挡下单）
 * - mock/stub 实现日志标 [MOCK] / [STUB]，便于排查
 *
 * 切换策略只改 .env 的 PAYMENT_STRATEGY，不改代码
 */

/**
 * 支付方式编码（与 Prisma PaymentMethod 枚举 / 契约 PaymentMethod z.enum 同步）
 *
 * 批B 补位 3 渠道（微信支付预留 2026-09-08，方案V2 §3.2）：
 * - WECHAT_GLOBAL：国际版微信——东帝汶不受理（微信跨境 49 国名单不含），仅占位
 * - ALIPAY_CN：支付宝（中国主体）——接口预留
 * - LOCAL_PSP：东帝汶本地支付服务商（Timor Telecom/Telkomcel 电子钱包等）——W6 后调研接入
 * 三者 enabled=true + available=false：列表可见"即将上线"，下单服务端拒绝（R2）。
 */
export type PaymentMethodCode =
  | 'COD'
  | 'BANK_TRANSFER'
  | 'WECHAT'
  | 'PAYPAL'
  | 'STRIPE'
  | 'WECHAT_GLOBAL'
  | 'ALIPAY_CN'
  | 'LOCAL_PSP';

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
  /** 第三方流水号；mock/stub 标识：MOCK_xxx / STUB_xxx；COD/BANK 用本地编号 COD_xxx / BANK_xxx */
  transactionId?: string;
  /** 客户端跳转 URL / SDK 参数（预付场景） */
  clientSecret?: string;
  /** 银行转账凭证 URL（BANK_TRANSFER 专用，用户上传后填入） */
  receiptUrl?: string;
  /** 第三方原始 payload（mock/stub 返回审计数据 / 真实回调 payload） */
  providerPayload?: unknown;
  /** mock/stub 标识（dev 期间为 true，prod 切真后为 false） */
  mockFlag: boolean;
  /** 应付时间（支付成功回调时填，与 PaymentStatus.PAID 同步） */
  paidAt?: string;
  createdAt: string;
}

export interface QueryPaymentInput {
  transactionId: string;
}

export interface PaymentStatusResult {
  transactionId: string;
  status: PaymentIntent['status'];
  /** 支付成功时间（status=PAID 时填） */
  paidAt?: string;
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

  /** 创建支付（订单创建后调用，构造 PaymentIntent 对象，调用方负责持久化） */
  createPayment(input: CreatePaymentInput): Promise<PaymentIntent>;

  /**
   * 查询支付状态（轮询/对账）— 仅第三方支付方式实现
   *
   * COD / BANK_TRANSFER 无第三方，状态由本地业务流程更新（collect-cash / 凭证审核），
   * 不实现此方法（调用方应直接从 DB PaymentIntent 读 status）。
   */
  queryPayment?(input: QueryPaymentInput): Promise<PaymentStatusResult>;

  /** 退款（取消订单 / 售后）。第三方支付是异步，应返回 PENDING */
  refund(input: RefundInput): Promise<RefundResult>;

  /** 是否为 mock/stub 实现（用于日志区分 + W7 上线前 checklist） */
  readonly isMock: boolean;
}
