/**
 * Review 模块类型定义（reviews-2）
 *
 * 决策依据：
 * - schema.prisma Review/RiderReview model（reviews-1 已建）
 * - 方案 v1.2：审核直接发布 / 商品评论一订单一条 / 骑手评价锁当前 riderId
 *
 * 类型对齐：
 *   - Prisma enum（大写）：ReviewStatus / ReviewCategory
 *   - contract zod enum（大写字面量，与 Prisma 同步）
 */
import type {
  ReviewStatus as PrismaReviewStatus,
  ReviewCategory as PrismaReviewCategory,
  OrderStatus as PrismaOrderStatus,
} from '../../prisma/client';

export type ReviewStatusValue = PrismaReviewStatus;
export type ReviewCategoryValue = PrismaReviewCategory;

/**
 * 已送达可评论的订单状态（F2：含 COD 三态 + COMPLETED）
 *
 * ❌ 不能只判 DELIVERED -- COD 订单送达是 DELIVERED_PAID/UNPAID，
 *    东帝汶 COD 是主力支付，只判 DELIVERED 会让所有 COD 单评不了。
 */
export const DELIVERED_STATUSES: ReadonlySet<PrismaOrderStatus> = new Set([
  'DELIVERED',
  'DELIVERED_PAID',
  'DELIVERED_UNPAID',
  'COMPLETED',
]);

/** 骑手评价标签枚举值（与 contract RiderReviewTag 同步，i18n key） */
export const RIDER_REVIEW_TAGS = ['on_time', 'polite', 'professional', 'careful'] as const;
export type RiderReviewTagValue = (typeof RIDER_REVIEW_TAGS)[number];

/** 评论类型（admin 列表 type 参数：客户评论 / 骑手评价） */
export type ReviewType = 'customer' | 'rider';

/** 客户评论创建入参（service 内部） */
export interface CreateReviewInput {
  userId: string;
  orderId: string;
  rating: number;
  content: Record<string, string>;
  images: string[];
  category: ReviewCategoryValue;
  productId?: string;
}

/** 骑手评价创建入参（service 内部） */
export interface CreateRiderReviewInput {
  userId: string;
  orderId: string;
  rating: number;
  tags: string[];
  comment?: Record<string, string>;
}

/** Admin 更新入参（审核 status + 商家回复 reply；P1-8：reply=null 清除，undefined 不改） */
export interface AdminUpdateReviewInput {
  status?: ReviewStatusValue;
  reply?: Record<string, string> | null;
}
