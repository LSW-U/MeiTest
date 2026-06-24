/**
 * Settle / Withdrawal schemas
 *
 * 流程 M（治理/财务）独占契约 — W3 settle 接口骨架。
 *
 * 决策依据：
 * - 金额单位：整数（分），不用 float（契约 v0.2 §1.3）
 * - 结算频率：T+1（决策 2026-06-24），接口预留配置项可改周/月结
 * - MVP 阶段：mock 订单数据聚合（C 流程订单/支付完成后切真）
 * - 错误码段：E-SETTLE-*（W2-COLLABORATION.md §3.4）
 */
import { z } from 'zod';
import { Money, IsoTimestamp, Id, ApiResponse, PaginatedResponse } from './common';

// ============================================================================
// Settlement（结算单）
// ============================================================================

/** 结算对象类型 */
export const SettlementSubjectType = z.enum(['MERCHANT', 'RIDER']);
export type SettlementSubjectTypeType = z.infer<typeof SettlementSubjectType>;

/** 结算单状态 */
export const SettlementStatus = z.enum(['PENDING', 'CONFIRMED', 'PAID', 'DISPUTED']);
export type SettlementStatusType = z.infer<typeof SettlementStatus>;

/** 结算单（前端列表/详情消费） */
export const SettlementSchema = z.object({
  id: Id,
  /** 结算周期 YYYY-MM-DD（按日聚合，T+1 触发） */
  periodDate: z.string(),
  subjectType: SettlementSubjectType,
  subjectId: z.string(),
  warehouseId: z.string().nullable(),
  orderCount: z.number().int().nonnegative(),
  grossAmount: Money,
  commission: Money,
  refundAmount: Money,
  /** 应结金额 = gross - commission - refund */
  netAmount: Money,
  status: SettlementStatus,
  confirmedAt: IsoTimestamp.nullable(),
  paidAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type SettlementType = z.infer<typeof SettlementSchema>;

/** 列表查询 */
export const SettlementQuery = z.object({
  subjectType: SettlementSubjectType.optional(),
  subjectId: z.string().optional(),
  periodFrom: z.string().optional(),
  periodTo: z.string().optional(),
  status: SettlementStatus.optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});
export type SettlementQueryType = z.infer<typeof SettlementQuery>;

/** 手动触发结算（super_admin 调试用，正常走 T+1 定时任务） */
export const SettlementRunInput = z.object({
  /** 结算周期 YYYY-MM-DD，缺省=昨天（T+1） */
  periodDate: z.string().optional(),
  subjectType: SettlementSubjectType,
  subjectId: z.string(),
});
export type SettlementRunInputType = z.infer<typeof SettlementRunInput>;

// ============================================================================
// WithdrawalRequest（提现申请）
// ============================================================================

/** 提现申请方类型 */
export const WithdrawalRequesterType = z.enum(['MERCHANT', 'RIDER']);
export type WithdrawalRequesterType = z.infer<typeof WithdrawalRequesterType>;

/** 提现状态 */
export const WithdrawalStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'FAILED']);
export type WithdrawalStatusType = z.infer<typeof WithdrawalStatus>;

/** 收款账户（多渠道统一 JSON） */
export const PayoutAccount = z.object({
  /** 渠道：BANK_TRANSFER / WECHAT / ALIPAY / PAYPAL（与 PaymentMethod 对齐） */
  channel: z.enum(['BANK_TRANSFER', 'WECHAT', 'ALIPAY', 'PAYPAL']),
  /** 渠道账号（银行卡号 / 支付宝账号 / 微信 openid 等） */
  account: z.string(),
  /** 持有人姓名（与账户同名验证） */
  holderName: z.string().optional(),
  /** 银行/支行信息（BANK_TRANSFER 专用） */
  bankName: z.string().optional(),
  branchName: z.string().optional(),
});
export type PayoutAccountType = z.infer<typeof PayoutAccount>;

/** 提现申请（前端表单） */
export const WithdrawalCreateInput = z.object({
  requesterType: WithdrawalRequesterType,
  requesterId: z.string(),
  amount: Money,
  payoutAccount: PayoutAccount,
});
export type WithdrawalCreateInputType = z.infer<typeof WithdrawalCreateInput>;

/** 提现申请记录（前端列表/详情消费） */
export const WithdrawalRequestSchema = z.object({
  id: Id,
  requesterType: WithdrawalRequesterType,
  requesterId: z.string(),
  amount: Money,
  status: WithdrawalStatus,
  payoutAccount: PayoutAccount,
  rejectReason: z.string().nullable(),
  payoutReference: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: IsoTimestamp.nullable(),
  paidAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type WithdrawalRequestType = z.infer<typeof WithdrawalRequestSchema>;

/** 提现审核（super_admin 操作） */
export const WithdrawalReviewInput = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectReason: z.string().optional(),
}).refine(
  (v) => v.action !== 'REJECT' || (v.rejectReason && v.rejectReason.length > 0),
  { message: 'rejectReason required when action=REJECT' },
);
export type WithdrawalReviewInputType = z.infer<typeof WithdrawalReviewInput>;

/** 线下打款记录（super_admin 录入） */
export const WithdrawalMarkPaidInput = z.object({
  payoutReference: z.string().min(1, 'payoutReference required (bank slip / transaction id)'),
});
export type WithdrawalMarkPaidInputType = z.infer<typeof WithdrawalMarkPaidInput>;

/** 提现列表查询 */
export const WithdrawalQuery = z.object({
  requesterType: WithdrawalRequesterType.optional(),
  requesterId: z.string().optional(),
  status: WithdrawalStatus.optional(),
  page: z.number().int().positive().default(1),
  pageSize: z.number().int().positive().max(100).default(20),
});
export type WithdrawalQueryType = z.infer<typeof WithdrawalQuery>;

// ============================================================================
// ApiResponse 包装（OpenAPI 注册用）
// ============================================================================

export const SettlementListResponse = PaginatedResponse(SettlementSchema);
export const SettlementDetailResponse = ApiResponse(SettlementSchema);
export const WithdrawalListResponse = PaginatedResponse(WithdrawalRequestSchema);
export const WithdrawalDetailResponse = ApiResponse(WithdrawalRequestSchema);

// ============================================================================
// 错误码（E-SETTLE-*）
// ============================================================================

export const SETTLE_ERROR_CODES = {
  /** 提现金额超过应结余额 */
  E_SETTLE_001: 'E-SETTLE-001',
  /** 提现申请不存在 */
  E_SETTLE_002: 'E-SETTLE-002',
  /** 提现申请状态不允许此操作（如已 PAID 不能 APPROVE） */
  E_SETTLE_003: 'E-SETTLE-003',
  /** 结算单不存在 */
  E_SETTLE_004: 'E-SETTLE-004',
  /** 结算频率配置无效（必须 day/week/month 之一） */
  E_SETTLE_005: 'E-SETTLE-005',
} as const;
