/**
 * Rider earnings schemas（批2 B-P1-2，R11 口径 20261003）
 *
 * R11 拍板：earnings 派生自既有 Settlement / WithdrawalRequest 表，不建新表、不加 balance 字段。
 *
 * 派生口径（T+1）：
 * - availableBalance = Σ Settlement.netAmount(subjectType=RIDER, status ∈ {CONFIRMED, PAID})
 *                      − Σ WithdrawalRequest.amount(requesterType=RIDER, status=PAID)
 * - today / weekly / monthly：同源 Settlement.netAmount 按 periodDate 滚动窗口聚合
 *   （today=当日 / weekly=近 7 天 / monthly=近 30 天，均仅计 CONFIRMED+PAID）
 * - 当日完成的订单尚未跑 T+1 结算任务 → 记 0，前端需明示"T+1 口径，今日收入次日到账"
 * - DISPUTED / PENDING 结算单不计入任何字段；REJECTED / FAILED 提现不扣减
 */
import { z } from 'zod';
import { Money, IsoTimestamp, Id, ApiResponse, OffsetPaginatedResponse } from './common';
import { PayoutAccount, WithdrawalRequesterType, WithdrawalStatus } from './settle';

/** 骑手收入汇总（4 字段均为金额分） */
export const RiderEarningsSummary = z.object({
  /** 可提现余额（分）= 已确认结算净额 − 已打款提现 */
  availableBalance: Money,
  /** 今日结算收入（分，T+1 口径：当日单未结算记 0） */
  today: Money,
  /** 近 7 天滚动窗口结算收入（分） */
  weekly: Money,
  /** 近 30 天滚动窗口结算收入（分） */
  monthly: Money,
});
export type RiderEarningsSummaryType = z.infer<typeof RiderEarningsSummary>;

/** 骑手收入流水行（Settlement(subjectType=RIDER) 视图；金额均为分） */
export const RiderEarningsTransactionSchema = z.object({
  id: Id,
  /** 结算周期 YYYY-MM-DD（T+1 按日聚合） */
  periodDate: z.string(),
  orderCount: z.number().int().nonnegative(),
  grossAmount: Money,
  commission: Money,
  refundAmount: Money,
  /** 应结金额（分）= gross − commission − refund */
  netAmount: Money,
  /** PENDING / CONFIRMED / PAID / DISPUTED（DISPUTED 不计入 summary/availableBalance） */
  status: z.string(),
  confirmedAt: IsoTimestamp.nullable(),
  paidAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
});
export type RiderEarningsTransactionType = z.infer<typeof RiderEarningsTransactionSchema>;

/** Guarded coerce（批A P1-1 先例：@Query 恒 string；仅纯数字串转换，'' / null / 其他 → undefined 由 schema 拒收） */
function coerceInt(input: unknown): unknown {
  if (typeof input === 'string' && /^\d+$/.test(input)) return Number(input);
  return input;
}

/** offset 分页 query（GET 用，guarded coerce 数字串；POST body 不适用） */
function offsetPageSchema() {
  return z.object({
    page: z.preprocess(coerceInt, z.number().int().positive().default(1)),
    pageSize: z.preprocess(coerceInt, z.number().int().positive().max(100).default(20)),
  });
}

/** 流水查询（offset 分页，参照 common.ts:49 OffsetPaginatedResponse 先例） */
export const RiderEarningsTransactionsQuery = offsetPageSchema();
export type RiderEarningsTransactionsQueryType = z.infer<typeof RiderEarningsTransactionsQuery>;

export const RiderEarningsSummaryResponse = ApiResponse(RiderEarningsSummary);
export const RiderEarningsTransactionsResponse = OffsetPaginatedResponse(
  RiderEarningsTransactionSchema,
);

// ============================================================================
// rider withdrawal 变体（复用 settle.ts 的 PayoutAccount / 状态机 schema）
// ============================================================================

/**
 * 骑手提现申请 body（批2）：仅 { amount, payoutAccount }。
 * requesterType / requesterId 由服务端硬编码（RIDER + req.user.sub），
 * 不收请求体——防伪造 requesterId 越权。
 */
export const RiderWithdrawalCreateInput = z.object({
  amount: Money,
  payoutAccount: PayoutAccount,
});
export type RiderWithdrawalCreateInputType = z.infer<typeof RiderWithdrawalCreateInput>;

/** 骑手提现列表查询：仅分页（requesterId 服务端强制，不收查询参数） */
export const RiderWithdrawalQuery = offsetPageSchema();
export type RiderWithdrawalQueryType = z.infer<typeof RiderWithdrawalQuery>;

// re-export 供 rider 模块消费（WithdrawalRequestSchema 本体在 settle.ts）
export { WithdrawalRequesterType, WithdrawalStatus };
