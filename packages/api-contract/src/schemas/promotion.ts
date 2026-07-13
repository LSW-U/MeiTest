/**
 * Promotion 模块 schema（W7-ext-G 2026-07-10）
 *
 * 3 类型促销：PERCENTAGE / FIXED_AMOUNT / FREE_DELIVERY
 * 配额：totalQuota + perUserLimit + 时间窗
 */
import { z } from 'zod';
import { Id, IsoTimestamp } from './common';

/** 促销类型 */
export const PromotionType = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']);

/** 促销状态 */
export const PromotionStatus = z.enum(['ACTIVE', 'PAUSED', 'DELETED']);

/** 促销实体 */
export const Promotion = z.object({
  id: Id,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: PromotionType,
  value: z.number().int().nonnegative(),
  minOrderAmount: z.number().int().nonnegative(),
  maxDiscountAmount: z.number().int().nonnegative().nullable(),
  totalQuota: z.number().int().positive().nullable(),
  usedCount: z.number().int().nonnegative(),
  perUserLimit: z.number().int().positive(),
  startAt: IsoTimestamp,
  endAt: IsoTimestamp,
  status: PromotionStatus,
  /** 创建人 userId（W7-ext-G P1-4 审计） */
  createdBy: z.string(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建促销请求 */
export const CreatePromotionRequest = z.object({
  code: z.string().min(3).max(20),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type: PromotionType,
  value: z.number().int().nonnegative(),
  minOrderAmount: z.number().int().nonnegative().optional(),
  maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
  totalQuota: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().optional(),
  startAt: IsoTimestamp,
  endAt: IsoTimestamp,
});

/** 编辑促销请求（status 用专门端点切换） */
export const UpdatePromotionRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  value: z.number().int().nonnegative().optional(),
  minOrderAmount: z.number().int().nonnegative().optional(),
  maxDiscountAmount: z.number().int().nonnegative().nullable().optional(),
  totalQuota: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().optional(),
  startAt: IsoTimestamp.optional(),
  endAt: IsoTimestamp.optional(),
});

/** 客户端校验促销码请求（W7-ext-G P1-3，购物车实时预览） */
export const ValidatePromotionRequest = z.object({
  code: z.string().min(1).max(20),
  orderAmount: z.number().int().nonnegative(),
  deliveryFee: z.number().int().nonnegative().optional(),
});

/** 校验结果 */
export const ValidatePromotionResponse = z.object({
  valid: z.boolean(),
  discount: z.number().int().nonnegative(),
  reason: z.string().optional(),
  type: PromotionType.optional(),
});
