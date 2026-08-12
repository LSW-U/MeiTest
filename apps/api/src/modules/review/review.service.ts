/**
 * Review Service — 评论中心业务（reviews-2）
 *
 * 决策依据（方案 v1.2）：
 * - 审核直接发布（status 默认 APPROVED）
 * - 客户评论 category 显式（PRODUCT/DELIVERY）+ rating 自动分（前端按 4-5好评/3中评/1-2差评）
 * - 骑手评价固定标签 + rating 全量重算（F4，事务内 aggregate AVG）
 * - 商品评论一订单一条（orderId unique）+ 可选绑 productId（须在订单商品内）
 * - 骑手评价锁当前 Order.riderId（F6）
 * - 评论删除硬删（决策4）
 *
 * 错误码：E-REVIEW-001(404) / 002(未送达409) / 003(已评论409) / 004(无骑手409) / 005(无权403) + E-COMMON-001
 */
import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction } from '../../shared/db';
import type { Review as DbReview, RiderReview as DbRiderReview } from '../../prisma/client';
import { DELIVERED_STATUSES } from './review.types';
import type {
  CreateReviewInput,
  CreateRiderReviewInput,
  AdminUpdateReviewInput,
  ReviewType,
  ReviewStatusValue,
  ReviewCategoryValue,
} from './review.types';

/** 客户评论视图（service → controller → client） */
export interface ReviewView {
  id: string;
  orderId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  rating: number;
  content: Record<string, string>;
  images: string[];
  /** 匿名评价标记（P15 B1） */
  anonymous: boolean;
  /** 商品评价快捷标签（P15 B1） */
  tags: string[];
  status: ReviewStatusValue;
  category: ReviewCategoryValue;
  reply: Record<string, string> | null;
  repliedAt: string | null;
  productId: string | null;
  createdAt: string;
}

/** 骑手评价视图 */
export interface RiderReviewView {
  id: string;
  orderId: string;
  riderId: string;
  userId: string;
  userName: string;
  rating: number;
  tags: string[];
  comment: Record<string, string> | null;
  status: ReviewStatusValue;
  createdAt: string;
}

/** 骑手评分默认值（无 APPROVED 评价时重置） */
const DEFAULT_RIDER_RATING = new Prisma.Decimal(5.0);

@Injectable()
export class ReviewService {
  // ===================== C 端 =====================

  /**
   * 客户提交订单/商品评论
   *
   * 校验：订单存在 + 归属该用户 + 已送达（F2 四态）+ 未评过 + productId 在订单内
   */
  async createReview(input: CreateReviewInput): Promise<ReviewView> {
    const order = await db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
        items: { select: { productId: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Order not found' });
    }
    if (order.userId !== input.userId) {
      throw new ForbiddenException({ code: 'E-REVIEW-005', message: 'Not your order' });
    }
    if (!DELIVERED_STATUSES.has(order.status)) {
      throw new ConflictException({
        code: 'E-REVIEW-002',
        message: 'Order not delivered yet, cannot review',
      });
    }

    // productId 须在订单商品内
    if (input.productId) {
      const inOrder = order.items.some((i) => i.productId === input.productId);
      if (!inOrder) {
        throw new BadRequestException({
          code: 'E-COMMON-001',
          message: 'productId not in this order',
        });
      }
    }

    // P0-2：existing 检查 + create 进事务（防并发双击撞 orderId unique），P2002 兜底转 E-REVIEW-003
    try {
      const review = await withTransaction(async (tx) => {
        const existing = await tx.review.findUnique({ where: { orderId: input.orderId } });
        if (existing) {
          throw new ConflictException({ code: 'E-REVIEW-003', message: 'Order already reviewed' });
        }
        const created = await tx.review.create({
          data: {
            orderId: input.orderId,
            userId: input.userId,
            userName: order.user.name ?? '',
            avatarUrl: order.user.avatarUrl,
            rating: input.rating,
            content: input.content as Prisma.InputJsonValue,
            images: input.images,
            anonymous: input.anonymous,
            tags: input.tags,
            category: input.category,
            productId: input.productId,
            status: 'APPROVED', // 决策1：默认直接发布
          },
        });
        return created;
      });
      return this.toReviewView(review);
    } catch (e) {
      // 并发：existing 检查过了但 create 撞 unique（双击/恶意并发）
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'E-REVIEW-003', message: 'Order already reviewed' });
      }
      throw e;
    }
  }

  /**
   * 客户提交骑手评价（事务：写评价 + 重算骑手评分）
   *
   * 校验：订单存在 + 归属 + 已送达 + 未评过 + order.riderId 非空（F6 锁当前骑手）
   */
  async createRiderReview(input: CreateRiderReviewInput): Promise<RiderReviewView> {
    const order = await db.order.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        userId: true,
        status: true,
        riderId: true,
        user: { select: { id: true, name: true } },
      },
    });

    if (!order) {
      throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Order not found' });
    }
    if (order.userId !== input.userId) {
      throw new ForbiddenException({ code: 'E-REVIEW-005', message: 'Not your order' });
    }
    if (!DELIVERED_STATUSES.has(order.status)) {
      throw new ConflictException({
        code: 'E-REVIEW-002',
        message: 'Order not delivered yet, cannot review rider',
      });
    }

    // F6：锁当前骑手。订单无骑手 -> 不能评
    if (!order.riderId) {
      throw new ConflictException({
        code: 'E-REVIEW-004',
        message: 'Order has no rider assigned',
      });
    }

    const riderId = order.riderId;
    // P1-1：existing 检查 + create + recalc 进同一事务，P2002 兜底（对齐 createReview P0-2）
    try {
      const created = await withTransaction(async (tx) => {
        const existing = await tx.riderReview.findUnique({ where: { orderId: input.orderId } });
        if (existing) {
          throw new ConflictException({ code: 'E-REVIEW-003', message: 'Rider already reviewed' });
        }
        const review = await tx.riderReview.create({
          data: {
            orderId: input.orderId,
            riderId,
            userId: input.userId,
            userName: order.user.name ?? '',
            rating: input.rating,
            tags: input.tags,
            comment: (input.comment as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            status: 'APPROVED',
          },
        });
        await this.recalcRiderRating(riderId, tx);
        return review;
      });
      return this.toRiderReviewView(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'E-REVIEW-003', message: 'Rider already reviewed' });
      }
      throw e;
    }
  }

  /** 商品评论列表（C 端商品详情页，仅 APPROVED） */
  async listProductReviews(
    productId: string,
    opts: { cursor?: string; limit?: number },
  ): Promise<{ items: ReviewView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(opts.limit ?? 20, 50);
    const items = await db.review.findMany({
      where: { productId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced.map((r) => this.toReviewView(r)),
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
      hasMore,
    };
  }

  /** 订单的骑手评价（C 端订单详情展示） */
  async getRiderReviewByOrder(orderId: string): Promise<RiderReviewView | null> {
    const r = await db.riderReview.findUnique({ where: { orderId } });
    return r ? this.toRiderReviewView(r) : null;
  }

  // ===================== Admin =====================

  /** Admin 列表（type=customer|rider + 多维筛选 + 游标分页） */
  async adminListReviews(query: {
    type: ReviewType;
    category?: ReviewCategoryValue;
    status?: ReviewStatusValue;
    rating?: number;
    keyword?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{
    items: ReviewView[] | RiderReviewView[];
    nextCursor: string | null;
    hasMore: boolean;
    total: number;
  }> {
    const limit = Math.min(query.limit ?? 20, 100);
    const keyword = query.keyword?.trim();

    if (query.type === 'customer') {
      const where: Prisma.ReviewWhereInput = {};
      if (query.category) where.category = query.category;
      if (query.status) where.status = query.status;
      if (query.rating) where.rating = query.rating;
      if (keyword) {
        where.OR = [
          { userName: { contains: keyword, mode: 'insensitive' } },
          { content: { string_contains: keyword } },
        ];
      }
      const [items, total] = await Promise.all([
        db.review.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit + 1,
          ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        }),
        db.review.count({ where }),
      ]);
      const hasMore = items.length > limit;
      const sliced = hasMore ? items.slice(0, limit) : items;
      return {
        items: sliced.map((r) => this.toReviewView(r)),
        nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
        hasMore,
        total,
      };
    }

    // rider
    const where: Prisma.RiderReviewWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;
    if (keyword) {
      where.OR = [
        { userName: { contains: keyword, mode: 'insensitive' } },
        { comment: { string_contains: keyword } },
      ];
    }
    const [items, total] = await Promise.all([
      db.riderReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      db.riderReview.count({ where }),
    ]);
    const hasMore = items.length > limit;
    const sliced = hasMore ? items.slice(0, limit) : items;
    return {
      items: sliced.map((r) => this.toRiderReviewView(r)),
      nextCursor: hasMore ? sliced[sliced.length - 1].id : null,
      hasMore,
      total,
    };
  }

  /** Admin 详情（?type=customer|rider） */
  async adminGetReview(id: string, type: ReviewType): Promise<ReviewView | RiderReviewView> {
    if (type === 'customer') {
      const r = await db.review.findUnique({ where: { id } });
      if (!r) {
        throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Review not found' });
      }
      return this.toReviewView(r);
    }
    const r = await db.riderReview.findUnique({ where: { id } });
    if (!r) {
      throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Rider review not found' });
    }
    return this.toRiderReviewView(r);
  }

  /** Admin 审核（status）+ 商家回复（reply，仅客户评论） */
  async adminUpdateReview(
    id: string,
    type: ReviewType,
    input: AdminUpdateReviewInput,
  ): Promise<ReviewView | RiderReviewView> {
    if (type === 'customer') {
      const existing = await db.review.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Review not found' });
      }
      const data: Prisma.ReviewUpdateInput = {};
      if (input.status) data.status = input.status;
      // P1-8：reply !== undefined 才更新；null = 清除（JsonNull + repliedAt null），对象 = 写入
      if (input.reply !== undefined) {
        data.reply = input.reply ? (input.reply as Prisma.InputJsonValue) : Prisma.JsonNull;
        data.repliedAt = input.reply ? new Date() : null;
      }
      // P15 B1：tags !== undefined 才更新；null/[] = 清空，array = 写入（anonymous 不可改 - 隐私）
      if (input.tags !== undefined) {
        data.tags = input.tags ?? [];
      }
      if (Object.keys(data).length === 0) return this.toReviewView(existing);
      const updated = await db.review.update({ where: { id }, data });
      return this.toReviewView(updated);
    }

    // rider：仅 status（骑手评价无 reply）
    const existing = await db.riderReview.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Rider review not found' });
    }
    // P1-5：status 未传 或 与当前相同 → 短路（避免无谓 update + recalc）
    if (!input.status || existing.status === input.status) {
      return this.toRiderReviewView(existing);
    }
    // P1-2：update + recalc 进事务（防 update 成功 recalc 失败致评分漂移）
    const updated = await withTransaction(async (tx) => {
      const r = await tx.riderReview.update({
        where: { id },
        data: { status: input.status },
      });
      await this.recalcRiderRating(existing.riderId, tx);
      return r;
    });
    return this.toRiderReviewView(updated);
  }

  /** Admin 删除（硬删，决策4）。删骑手评价后重算 rating */
  async adminDeleteReview(id: string, type: ReviewType): Promise<void> {
    if (type === 'customer') {
      const existing = await db.review.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Review not found' });
      }
      await db.review.delete({ where: { id } });
      return;
    }
    const existing = await db.riderReview.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ code: 'E-REVIEW-001', message: 'Rider review not found' });
    }
    // P1-2：delete + recalc 进事务（防 delete 成功 recalc 失败致评分漂移）
    await withTransaction(async (tx) => {
      await tx.riderReview.delete({ where: { id } });
      await this.recalcRiderRating(existing.riderId, tx);
    });
  }

  // ===================== 内部 =====================

  /**
   * 骑手评分全量重算（F4）
   *
   * SELECT AVG(rating) FROM rider_reviews WHERE rider_id=? AND status='APPROVED'
   * 用 Prisma aggregate（类型安全，事务内可用）。无 APPROVED 评价 -> 重置 5.00。
   * Decimal(3,2)：avg.toFixed(2) 保证 2 位精度，禁止 JS 层 Decimal 算术。
   */
  async recalcRiderRating(
    riderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? db;
    const agg = await client.riderReview.aggregate({
      _avg: { rating: true },
      _count: true,
      where: { riderId, status: 'APPROVED' },
    });
    const rating =
      agg._count === 0 || agg._avg.rating == null
        ? DEFAULT_RIDER_RATING
        : new Prisma.Decimal(agg._avg.rating.toFixed(2));
    await client.riderProfile.update({
      where: { id: riderId },
      data: { rating },
    });
  }

  private toReviewView(r: DbReview): ReviewView {
    return {
      id: r.id,
      orderId: r.orderId,
      userId: r.userId,
      userName: r.userName,
      avatarUrl: r.avatarUrl,
      rating: r.rating,
      content: r.content as Record<string, string>,
      images: r.images,
      anonymous: r.anonymous,
      tags: r.tags,
      status: r.status,
      category: r.category,
      reply: (r.reply as Record<string, string> | null) ?? null,
      repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
      productId: r.productId,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toRiderReviewView(r: DbRiderReview): RiderReviewView {
    return {
      id: r.id,
      orderId: r.orderId,
      riderId: r.riderId,
      userId: r.userId,
      userName: r.userName,
      rating: r.rating,
      tags: r.tags,
      comment: (r.comment as Record<string, string> | null) ?? null,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
