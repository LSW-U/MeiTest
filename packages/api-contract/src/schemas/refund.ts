/**
 * 退款模块 schema（W5 流程 C 任务）
 *
 * 决策依据：
 * - W-M-C-T 任务分解 §流程 2 W5：M1 refund 简化退款
 *   - MVP 规则：接单前全额退 / 接单后商家决定
 *   - 原路回款（微信退款 API，W2 阶段为 mock）
 *
 * W2 阶段：schema 提前定义，service 实现放 W5
 */
import { z } from 'zod';
import { Id, Money, IsoTimestamp } from './common';

/** 退款状态 */
export const RefundStatus = z.enum([
  'PENDING', // 客户申请，待商家审核
  'APPROVED', // 商家通过，待打款
  'REJECTED', // 商家驳回
  'COMPLETED', // 已退款（原路回款成功）
  'FAILED', // 退款失败（第三方错误）
  'CANCELLED', // 客户撤回申请
]);

/** 退款原因（结构化，便于 BI） */
export const RefundReason = z.enum([
  'OUT_OF_STOCK', // 缺货
  'QUALITY_ISSUE', // 商品质量问题
  'WRONG_ITEM', // 发错货
  'DELIVERY_TOO_SLOW', // 配送太慢
  'CUSTOMER_CHANGE_MIND', // 客户改变主意
  'OTHER',
]);

/** 退款申请 */
export const Refund = z.object({
  id: Id,
  orderId: Id,
  userId: Id,
  amount: Money,
  reason: RefundReason,
  reasonDetail: z.string().max(500).nullable(),
  status: RefundStatus,
  /** 退款流水号（mock 标 MOCK_ 前缀） */
  transactionId: z.string().nullable(),
  /** 退款方式（与原 PaymentIntent.method 一致） */
  refundMethod: z.string(),
  /** 商家审核人 userId */
  reviewedBy: Id.nullable(),
  reviewedAt: IsoTimestamp.nullable(),
  reviewNote: z.string().nullable(),
  completedAt: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建退款请求 */
export const CreateRefundRequest = z.object({
  orderId: Id,
  reason: RefundReason,
  reasonDetail: z.string().max(500).optional(),
});

/** 商家审核退款请求 */
export const ReviewRefundRequest = z.object({
  refundId: Id,
  action: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().max(500).optional(),
});
