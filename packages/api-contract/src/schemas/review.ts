/**
 * Review 模块 schema（评论中心，reviews-2）
 *
 * 决策依据（方案 v1.2）：
 * - 审核直接发布（status 默认 APPROVED，PENDING 预留）
 * - 客户评论 category 显式（PRODUCT/DELIVERY）+ rating 自动分（前端按 4-5好评/3中评/1-2差评）
 * - 骑手评价固定标签枚举（on_time/polite/professional/careful），i18n key
 * - 商品评论一订单一条（orderId unique）+ 可选绑 productId
 * - 评论删除硬删（不加 deletedAt）
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText } from './common';

/** 评论审核状态（与 schema.prisma ReviewStatus 同步） */
export const ReviewStatus = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

/** 客户评论分类（决策2：PRODUCT 商品评论 / DELIVERY 配送评论） */
export const ReviewCategory = z.enum(['PRODUCT', 'DELIVERY']);

/** 骑手评价标签（固定枚举，i18n key，决策3） */
export const RiderReviewTag = z.enum(['on_time', 'polite', 'professional', 'careful']);

/** 客户评论视图 */
export const Review = z.object({
  id: Id,
  orderId: Id,
  userId: Id,
  userName: z.string(),
  avatarUrl: z.string().nullable(),
  rating: z.number().int().min(1).max(5),
  content: I18nText,
  images: z.array(z.string()),
  status: ReviewStatus,
  category: ReviewCategory,
  reply: I18nText.nullable(),
  repliedAt: IsoTimestamp.nullable(),
  /** 商品评论绑定的商品 ID（订单整体评论则 null） */
  productId: Id.nullable(),
  createdAt: IsoTimestamp,
});

/** 骑手评价视图 */
export const RiderReview = z.object({
  id: Id,
  orderId: Id,
  riderId: Id,
  userId: Id,
  userName: z.string(),
  rating: z.number().int().min(1).max(5),
  tags: z.array(RiderReviewTag),
  comment: I18nText.nullable(),
  status: ReviewStatus,
  createdAt: IsoTimestamp,
});

/** 客户提交订单/商品评论（C 端 POST /client/orders/:id/review） */
export const CreateReviewRequest = z.object({
  rating: z.number().int().min(1).max(5),
  /** 多语言评论文本 */
  content: I18nText,
  images: z.array(z.string().url()).max(9).default([]),
  category: ReviewCategory,
  /** 商品评论绑定的商品 ID（可选；订单整体评论则不传） */
  productId: Id.optional(),
});

/** 客户提交骑手评价（C 端 POST /client/orders/:id/rider-review） */
export const CreateRiderReviewRequest = z.object({
  rating: z.number().int().min(1).max(5),
  tags: z.array(RiderReviewTag).max(4).default([]),
  /** 文字评价（多语言，可选） */
  comment: I18nText.optional(),
});

/** Admin 评论列表筛选（type 区分客户评论/骑手评价） */
export const AdminListReviewsQuery = z.object({
  type: z.enum(['customer', 'rider']),
  category: ReviewCategory.optional(),
  status: ReviewStatus.optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  keyword: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Admin 审核 + 商家回复（PATCH） */
export const AdminUpdateReviewRequest = z.object({
  /** 审核状态（骑手评价无 reply，仅用 status） */
  status: ReviewStatus.optional(),
  /** 商家回复（多语言，仅客户评论有意义；P1-8：null = 清除回复，undefined = 不改） */
  reply: I18nText.nullable().optional(),
});
