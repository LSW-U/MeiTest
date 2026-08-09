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
import { Id, Money, IsoTimestamp, I18nText, PaginatedResponse } from './common';

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
  'EXPIRED', // 商品变质 / 过期（P13 新增）
  'QUALITY_ISSUE', // 商品质量问题
  'WRONG_ITEM', // 发错货
  'SHORTAGE', // 少件 / 缺件（P13 新增）
  'DELIVERY_TOO_SLOW', // 配送太慢
  'CUSTOMER_CHANGE_MIND', // 客户改变主意
  'OTHER',
]);

/** 退款商品子表项（P13 部分退款，2026-08-08）
 *  存「本次退款退了哪些 OrderItem 的多少数量」；subtotal = unitPrice × refundQty
 */
export const RefundItem = z.object({
  id: Id,
  refundId: Id,
  orderItemId: Id,
  skuId: Id,
  /** 多语言商品名快照（同 OrderItem.productName） */
  productName: I18nText,
  /** 下单时单价快照（分，同 OrderItem.unitPrice） */
  unitPrice: Money,
  /** 本单退款数量（≤ OrderItem.quantity） */
  refundQty: z.number().int().min(1),
  /** = unitPrice × refundQty（分） */
  subtotal: Money,
});

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
  /** 退款商品列表（P13 部分退款；整单退款时为空数组） */
  items: z.array(RefundItem),
});

/** 创建退款请求 */
export const CreateRefundRequest = z.object({
  orderId: Id,
  reason: RefundReason,
  reasonDetail: z.string().max(500).optional(),
  /** 部分退款商品列表（不传 = 整单全额退款，向后兼容）
   *  传则 amount = sum(unitPrice × refundQty)；不传则 amount = order.payableAmount
   */
  items: z
    .array(
      z.object({
        orderItemId: Id,
        refundQty: z.number().int().min(1),
      }),
    )
    .optional(),
});

/** 商家审核退款请求 */
export const ReviewRefundRequest = z.object({
  refundId: Id,
  action: z.enum(['APPROVE', 'REJECT']),
  reviewNote: z.string().max(500).optional(),
});

/**
 * admin 退款列表查询（游标分页，批次 2.1 改造）
 * 与 admin orders 列表一致：cursor / limit + status 过滤
 */
export const ListRefundsQuery = z.object({
  status: RefundStatus.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** admin 退款列表响应（游标分页：items + nextCursor + hasMore） */
export const RefundListResponse = PaginatedResponse(Refund);
