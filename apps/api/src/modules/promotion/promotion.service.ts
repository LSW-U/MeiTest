/**
 * Promotion Service - 促销/优惠券管理（W7-ext-G）
 *
 * 决策依据：
 * - CLAUDE.md §业务决策 4：MVP 同步事务
 * - 3 类型：PERCENTAGE（百分比）/ FIXED_AMOUNT（立减）/ FREE_DELIVERY（免配送费）
 * - 配额：totalQuota（总量）+ perUserLimit（单用户限用）+ 时间窗（startAt/endAt）
 * - 下单时 createOrder 调 applyPromotion 校验 + 计算 discountAmount + 原子 increment
 *
 * 错误码段：E-PROMO-001 ~ E-PROMO-099
 */
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db, withTransaction } from '../../shared/db';
import type { Tx } from '../../shared/db';
import { logger } from '../../shared/logger/logger';

export type PromotionTypeValue = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_DELIVERY';
export type PromotionStatusValue = 'ACTIVE' | 'PAUSED' | 'DELETED';

export interface PromotionView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: PromotionTypeValue;
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  totalQuota: number | null;
  usedCount: number;
  perUserLimit: number;
  startAt: string;
  endAt: string;
  status: PromotionStatusValue;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromotionInput {
  code: string;
  name: string;
  description?: string;
  type: PromotionTypeValue;
  value: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  totalQuota?: number | null;
  perUserLimit?: number;
  startAt: string;
  endAt: string;
  /** 创建人 userId（W7-ext-G P1-4 审计） */
  createdBy: string;
}

export interface UpdatePromotionInput {
  name?: string;
  description?: string | null;
  value?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  totalQuota?: number | null;
  perUserLimit?: number;
  startAt?: string;
  endAt?: string;
}

/** 折扣计算结果（createOrder 用） */
export interface AppliedDiscount {
  promotionId: string;
  code: string;
  type: PromotionTypeValue;
  discountAmount: number;
}

/** 客户端优惠券视图（B10，隐藏 createdBy/usedCount/totalQuota/perUserLimit 等管理字段） */
export interface ClientCouponView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: PromotionTypeValue;
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  startAt: string;
  endAt: string;
  status: 'available' | 'used' | 'expired';
}

/**
 * 我的卡包视图（P1 领券体系，UserCoupon 实例维度）
 *
 * 与 ClientCouponView（模板维度）的区别：
 *   - id = UserCoupon.id（不是 Promotion.id）
 *   - status = unused/used/expired（用户实例状态，精确）
 *   - 带 promotionId / receivedAt / usedAt / orderId（追溯用）
 */
export interface MyCouponView {
  /** UserCoupon.id（下单用 couponId 传这个） */
  id: string;
  promotionId: string;
  code: string;
  status: 'unused' | 'used' | 'expired';
  type: PromotionTypeValue;
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  name: string;
  description: string | null;
  startAt: string;
  endAt: string;
  /** 领取时间 */
  receivedAt: string;
  /** 使用时间（status=used 时） */
  usedAt: string | null;
  /** 关联订单（status=used 时） */
  orderId: string | null;
}

/** applyCoupon 返回（createOrder 事务内用） */
export interface AppliedCouponDiscount {
  userCouponId: string;
  promotionId: string;
  code: string;
  type: PromotionTypeValue;
  discountAmount: number;
}

@Injectable()
export class PromotionService {
  /** 列表（按 status / type 筛选 + 关键字） */
  async list(options: {
    status?: PromotionStatusValue;
    type?: PromotionTypeValue;
    keyword?: string;
    limit?: number;
  }): Promise<PromotionView[]> {
    const limit = Math.min(options.limit ?? 50, 100);
    const where: {
      status?: PromotionStatusValue;
      type?: PromotionTypeValue;
      OR?: Array<{ code?: { contains: string }; name?: { contains: string } }>;
    } = {};
    if (options.status) where.status = options.status;
    if (options.type) where.type = options.type;
    if (options.keyword) {
      where.OR = [
        { code: { contains: options.keyword } },
        { name: { contains: options.keyword } },
      ];
    }

    const rows = await db.promotion.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toView(r));
  }

  /** 详情 */
  async detail(id: string): Promise<PromotionView> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'E-PROMO-001', message: 'Promotion not found' });
    }
    return this.toView(row);
  }

  /** 创建 */
  async create(input: CreatePromotionInput): Promise<PromotionView> {
    this.validateInput(input);
    const code = input.code.trim().toUpperCase();
    // 校验 code 唯一
    const existing = await db.promotion.findUnique({ where: { code } });
    if (existing) {
      throw new ConflictException({ code: 'E-PROMO-002', message: 'Promotion code already exists' });
    }

    const row = await db.promotion.create({
      data: {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        value: input.value,
        minOrderAmount: input.minOrderAmount ?? 0,
        maxDiscountAmount: input.maxDiscountAmount ?? null,
        totalQuota: input.totalQuota ?? null,
        perUserLimit: input.perUserLimit ?? 1,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        status: 'ACTIVE',
        createdBy: input.createdBy,
      },
    });
    logger.info({ msg: 'PROMOTION_CREATED', promotionId: row.id, code });
    return this.toView(row);
  }

  /** 编辑（status 用专门端点切换，此处不动 status） */
  async update(id: string, input: UpdatePromotionInput): Promise<PromotionView> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'E-PROMO-001', message: 'Promotion not found' });
    }
    if (row.status === 'DELETED') {
      throw new ConflictException({ code: 'E-PROMO-003', message: 'Cannot edit deleted promotion' });
    }

    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.value !== undefined) data.value = input.value;
    if (input.minOrderAmount !== undefined) data.minOrderAmount = input.minOrderAmount;
    if (input.maxDiscountAmount !== undefined) data.maxDiscountAmount = input.maxDiscountAmount;
    if (input.totalQuota !== undefined) data.totalQuota = input.totalQuota;
    if (input.perUserLimit !== undefined) data.perUserLimit = input.perUserLimit;
    if (input.startAt !== undefined) data.startAt = new Date(input.startAt);
    if (input.endAt !== undefined) data.endAt = new Date(input.endAt);

    // 校验时间窗
    const startAt = (data.startAt as Date | undefined) ?? row.startAt;
    const endAt = (data.endAt as Date | undefined) ?? row.endAt;
    if (startAt >= endAt) {
      throw new BadRequestException({ code: 'E-PROMO-004', message: 'endAt must be after startAt' });
    }
    // 校验 value
    if (data.value !== undefined || data.type !== undefined) {
      const type = (data.type as PromotionTypeValue | undefined) ?? row.type;
      const value = (data.value as number | undefined) ?? row.value;
      this.validateValue(type, value);
    }

    if (Object.keys(data).length === 0) {
      return this.toView(row);
    }

    const updated = await db.promotion.update({ where: { id }, data });
    logger.info({ msg: 'PROMOTION_UPDATED', promotionId: id });
    return this.toView(updated);
  }

  /** 激活 */
  async activate(id: string): Promise<PromotionView> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'E-PROMO-001', message: 'Promotion not found' });
    }
    if (row.status === 'DELETED') {
      throw new ConflictException({ code: 'E-PROMO-005', message: 'Cannot activate deleted promotion' });
    }
    if (row.status === 'ACTIVE') {
      throw new ConflictException({ code: 'E-PROMO-006', message: 'Promotion already active' });
    }
    const updated = await db.promotion.update({ where: { id }, data: { status: 'ACTIVE' } });
    logger.info({ msg: 'PROMOTION_ACTIVATED', promotionId: id });
    return this.toView(updated);
  }

  /** 暂停 */
  async pause(id: string): Promise<PromotionView> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'E-PROMO-001', message: 'Promotion not found' });
    }
    if (row.status !== 'ACTIVE') {
      throw new ConflictException({ code: 'E-PROMO-007', message: 'Only active promotion can be paused' });
    }
    const updated = await db.promotion.update({ where: { id }, data: { status: 'PAUSED' } });
    logger.info({ msg: 'PROMOTION_PAUSED', promotionId: id });
    return this.toView(updated);
  }

  /** 软删（status=DELETED，保留数据） */
  async remove(id: string): Promise<{ id: string; status: PromotionStatusValue }> {
    const row = await db.promotion.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException({ code: 'E-PROMO-001', message: 'Promotion not found' });
    }
    if (row.status === 'DELETED') {
      throw new ConflictException({ code: 'E-PROMO-008', message: 'Promotion already deleted' });
    }
    await db.promotion.update({ where: { id }, data: { status: 'DELETED' } });
    logger.info({ msg: 'PROMOTION_DELETED', promotionId: id });
    return { id, status: 'DELETED' };
  }

  /**
   * 应用促销码（createOrder 调用）
   *
   * 校验：存在 + ACTIVE + 时间窗 + minOrderAmount + perUserLimit + totalQuota
   * 计算：按 type 算 discountAmount
   * 原子 increment usedCount（带 totalQuota 守卫，防超发）
   *
   * 返回 AppliedDiscount；无效码抛 BadRequestException
   */
  async applyPromotion(
    code: string,
    userId: string,
    totalAmount: number,
    deliveryFee: number,
    tx?: Tx,
  ): Promise<AppliedDiscount> {
    const client = tx ?? db;
    const normalizedCode = code.trim().toUpperCase();
    const promo = await client.promotion.findUnique({ where: { code: normalizedCode } });
    if (!promo) {
      throw new BadRequestException({ code: 'E-PROMO-009', message: 'Invalid promotion code' });
    }
    if (promo.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'E-PROMO-010', message: 'Promotion is not active' });
    }
    const now = new Date();
    if (now < promo.startAt || now > promo.endAt) {
      throw new BadRequestException({ code: 'E-PROMO-011', message: 'Promotion is not within valid period' });
    }
    if (totalAmount < promo.minOrderAmount) {
      throw new BadRequestException({
        code: 'E-PROMO-012',
        message: `Order amount does not meet minimum ${promo.minOrderAmount}`,
      });
    }

    // P1-1：单用户限用校验（事务内 count OrderPromotion，防超 perUserLimit 滥用）
    const userUsedCount = await client.orderPromotion.count({
      where: { promotionId: promo.id, order: { userId } },
    });
    if (userUsedCount >= promo.perUserLimit) {
      throw new BadRequestException({
        code: 'E-PROMO-020',
        message: `Promotion per-user limit reached (${promo.perUserLimit})`,
      });
    }

    const discountAmount = this.computeDiscount(promo, totalAmount, deliveryFee);

    // 原子 increment + 配额守卫（仿 deductStock：UPDATE ... WHERE used_count < total_quota）
    // 消除 read-check-then-write race，防并发超发。
    // $executeRaw 返回影响行数：0 = 配额已满（或并发抢光），抛 E-PROMO-013
    const affected = await client.$executeRaw`
      UPDATE "promotions"
      SET used_count = used_count + 1
      WHERE id = ${promo.id}
        AND (total_quota IS NULL OR used_count < total_quota)
    `;
    if (affected === 0) {
      throw new ConflictException({ code: 'E-PROMO-013', message: 'Promotion quota exhausted' });
    }

    logger.info({
      msg: 'PROMOTION_APPLIED',
      promotionId: promo.id,
      code: promo.code,
      userId,
      discountAmount,
    });

    return {
      promotionId: promo.id,
      code: promo.code,
      type: promo.type,
      discountAmount,
    };
  }

  /**
   * 客户端校验促销码（W7-ext-G P1-3）：购物车实时预览折扣
   *
   * 与 applyPromotion 的区别：只读校验，不 increment usedCount。
   * 返回 { valid, discount, reason?, type? }，reason 仅 valid=false 时有值。
   */
  async validatePromotion(
    code: string,
    orderAmount: number,
    deliveryFee: number,
  ): Promise<{
    valid: boolean;
    discount: number;
    reason?: string;
    type?: PromotionTypeValue;
  }> {
    const normalizedCode = code.trim().toUpperCase();
    const promo = await db.promotion.findUnique({ where: { code: normalizedCode } });
    if (!promo) {
      return { valid: false, discount: 0, reason: 'INVALID_CODE' };
    }
    if (promo.status !== 'ACTIVE') {
      return { valid: false, discount: 0, reason: 'NOT_ACTIVE' };
    }
    const now = new Date();
    if (now < promo.startAt || now > promo.endAt) {
      return { valid: false, discount: 0, reason: 'NOT_IN_PERIOD' };
    }
    if (orderAmount < promo.minOrderAmount) {
      return { valid: false, discount: 0, reason: 'BELOW_MIN_ORDER' };
    }
    if (promo.totalQuota !== null && promo.usedCount >= promo.totalQuota) {
      return { valid: false, discount: 0, reason: 'QUOTA_EXHAUSTED' };
    }
    const discount = this.computeDiscount(promo, orderAmount, deliveryFee);
    return { valid: true, discount, type: promo.type };
  }

  /**
   * 客户端优惠券列表（B10 + used/expired 扩展，GET /client/coupons?status=）
   *
   * @deprecated P1 领券卡包体系（2026-07-31）后改用 listMyCoupons（UserCoupon 精确查）。
   * 此方法从 OrderPromotion 派生 used/expired（不精确），仅保留给未迁移的旧调用方，
   * controller 已切到 listMyCoupons。后续前端全量迁移后删除本法 + 其单测。
   *
   * - available（默认）：ACTIVE + 有效期内 + 未超额
   * - used：该用户用过的券（OrderPromotion JOIN Order.userId，去重 promotionId，按最近使用排序）
   * - expired（E2）：我用过且已过期（usedPromoIds ∩ endAt<now）
   *
   * MVP 无领券机制，靠 OrderPromotion（下单用券记录）派生 used/expired，不需新表。
   * 隐藏 createdBy/usedCount/totalQuota/perUserLimit 管理字段。
   */
  async listClientCoupons(
    status: 'available' | 'used' | 'expired' = 'available',
    userId?: string,
  ): Promise<ClientCouponView[]> {
    const now = new Date();

    // used / expired 都需先查用户用过的 promotionId（OrderPromotion JOIN Order.userId）
    if (status === 'used' || status === 'expired') {
      if (!userId) return [];
      const usedRecords = await db.orderPromotion.findMany({
        where: { order: { userId } },
        select: { promotionId: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });
      // 去重 promotionId，保留每券最近一次使用时间（用于 used 排序）
      const latestUsedAt = new Map<string, Date>();
      for (const r of usedRecords) {
        if (!latestUsedAt.has(r.promotionId)) latestUsedAt.set(r.promotionId, r.createdAt);
      }
      const promoIds = [...latestUsedAt.keys()];
      if (promoIds.length === 0) return [];

      const expired = status === 'expired';
      const rows = await db.promotion.findMany({
        // P1-3：过滤 DELETED 券（软删不进 used/expired 历史；PAUSED 保留 -- 用户用过的暂停券仍可见）
        where: expired
          ? { id: { in: promoIds }, endAt: { lt: now }, status: { not: 'DELETED' } }
          : { id: { in: promoIds }, status: { not: 'DELETED' } },
        orderBy: expired ? { endAt: 'desc' } : undefined,
      });
      // used 按"最近使用时间"desc 排序（DB 无法直接按 OrderPromotion.createdAt 排 Promotion，内存排）
      if (!expired) {
        rows.sort(
          (a, b) => (latestUsedAt.get(b.id)?.getTime() ?? 0) - (latestUsedAt.get(a.id)?.getTime() ?? 0),
        );
      }
      return rows.map((r) => this.toClientCouponView(r, status));
    }

    // available（现有逻辑，向后兼容）
    const rows = await db.promotion.findMany({
      where: { status: 'ACTIVE', startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { createdAt: 'desc' },
    });
    return rows
      .filter((r) => r.totalQuota === null || r.usedCount < r.totalQuota)
      .map((r) => this.toClientCouponView(r, 'available'));
  }

  // ============================================================================
  // P1 领券卡包体系（UserCoupon 维度）
  // 决策依据：方案 §3/§6（2026-07-31）
  //   - 领券中心：listAvailableTemplates（全局可领模板，排除已领）
  //   - 领取：claimCoupon / redeemCoupon（码兑换）-> 生成 UserCoupon(UNUSED)
  //   - 卡包：listMyCoupons（按 unused/used/expired 精确查 UserCoupon）
  //   - 下单用券：applyCoupon（createOrder 事务内调，UNUSED -> USED）
  //   - 过期：expireStaleCoupons（BullMQ 每 5min 扫，UNUSED + endAt<now -> EXPIRED）
  // 错误码段：E-COUPON-001 ~ E-COUPON-005
  // ============================================================================

  /**
   * 领券中心：可领的模板列表（GET /client/coupons/available）
   *
   * 筛选：ACTIVE + 有效期内 + 未超额 + 当前用户未领过（NOT userCoupons.some）
   * 返回 ClientCouponView（status='available'），与旧 listClientCoupons('available') 形状一致。
   */
  async listAvailableTemplates(userId: string): Promise<ClientCouponView[]> {
    const now = new Date();
    const rows = await db.promotion.findMany({
      where: {
        status: 'ACTIVE',
        startAt: { lte: now },
        endAt: { gte: now },
        // 排除当前用户已领过的券（@@unique 保证每券每人 1 张，some 即"已领"）
        NOT: { userCoupons: { some: { userId } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // totalQuota 可空，DB 层无法表达 usedCount < totalQuota（nullable 比较），内存过滤
    return rows
      .filter((r) => r.totalQuota === null || r.usedCount < r.totalQuota)
      .map((r) => this.toClientCouponView(r, 'available'));
  }

  /**
   * 领取优惠券（POST /client/coupons/:promotionId/claim）
   *
   * 流程：校验模板可领 -> 事务内创建 UserCoupon(UNUSED) + 原子 increment promotion.usedCount（配额守卫）
   * 配额语义：usedCount = 已发放数（"限发 N 张"），领取即占位，下单不重复 increment
   * 重复领取：@@unique([userId,promotionId]) 触发 P2002 -> E-COUPON-003
   */
  async claimCoupon(promotionId: string, userId: string): Promise<MyCouponView> {
    const promo = await db.promotion.findUnique({ where: { id: promotionId } });
    if (!promo) {
      throw new NotFoundException({ code: 'E-COUPON-004', message: 'Coupon template not available' });
    }
    this.assertTemplateClaimable(promo);

    try {
      const uc = await withTransaction(async (tx: Tx) => {
        const created = await tx.userCoupon.create({
          data: {
            userId,
            promotionId: promo.id,
            code: promo.code,
            status: 'UNUSED',
          },
          include: { promotion: true },
        });
        // 原子 increment + 配额守卫（消除 read-check-then-write race，防并发超发）
        // affected=0 = 配额已满（或并发抢光），抛 E-COUPON-004，事务回滚 UserCoupon 创建
        const affected = await tx.$executeRaw`
          UPDATE "promotions"
          SET used_count = used_count + 1
          WHERE id = ${promo.id}
            AND (total_quota IS NULL OR used_count < total_quota)
        `;
        if (affected === 0) {
          throw new ConflictException({
            code: 'E-COUPON-004',
            message: 'Coupon quota exhausted',
          });
        }
        return created;
      });

      logger.info({
        msg: 'COUPON_CLAIMED',
        userCouponId: uc.id,
        userId,
        promotionId: promo.id,
        code: promo.code,
      });
      return this.toMyCouponView(uc);
    } catch (e) {
      // P2002 = @@unique([userId, promotionId]) 冲突 -> 已领过
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'E-COUPON-003',
          message: 'Coupon already claimed by this user',
        });
      }
      throw e;
    }
  }

  /**
   * 码兑换领取（POST /client/coupons/redeem）
   *
   * 优惠码不再"即用"，改为"输码领到卡包"。按 code 找模板 -> claimCoupon。
   * 码不存在 / 不 ACTIVE / 不在有效期 -> E-COUPON-004（统一"模板不可领"）
   */
  async redeemCoupon(code: string, userId: string): Promise<MyCouponView> {
    const normalizedCode = code.trim().toUpperCase();
    const promo = await db.promotion.findUnique({ where: { code: normalizedCode } });
    if (!promo) {
      throw new BadRequestException({
        code: 'E-COUPON-004',
        message: 'Invalid coupon code',
      });
    }
    return this.claimCoupon(promo.id, userId);
  }

  /**
   * 我的卡包（GET /client/coupons?status=unused|used|expired）
   *
   * 精确查 UserCoupon（不再从 OrderPromotion 派生）：
   *   - unused：status=UNUSED 且 promotion.endAt>=now（过期未标记的归 expired tab）
   *   - used：status=USED
   *   - expired：status=EXPIRED 或 (status=UNUSED 且 endAt<now)（定时任务未跑时的查询兜底）
   *   - 不传 status：全部返回（按行派生 status）
   */
  async listMyCoupons(
    userId: string,
    status?: 'unused' | 'used' | 'expired',
  ): Promise<MyCouponView[]> {
    const now = new Date();
    const baseWhere = { userId };

    let where: Prisma.UserCouponWhereInput;
    if (status === 'unused') {
      where = { ...baseWhere, status: 'UNUSED', promotion: { endAt: { gte: now } } };
    } else if (status === 'used') {
      where = { ...baseWhere, status: 'USED' };
    } else if (status === 'expired') {
      // OR：已标记 EXPIRED，或 UNUSED 但模板已过期（定时任务未跑的兜底）
      where = {
        ...baseWhere,
        OR: [
          { status: 'EXPIRED' },
          { status: 'UNUSED', promotion: { endAt: { lt: now } } },
        ],
      };
    } else {
      where = baseWhere;
    }

    const rows = await db.userCoupon.findMany({
      where,
      include: { promotion: true },
      orderBy: { receivedAt: 'desc' },
    });
    return rows.map((r) => this.toMyCouponView(r));
  }

  /**
   * 下单用券（createOrder 事务内调用，替代旧 applyPromotion）
   *
   * 校验：归属（userId）+ 状态（UNUSED，未过期）+ 模板（ACTIVE）+ 门槛
   * 副作用：UserCoupon UNUSED -> USED（写 usedAt，不写 orderId -- 由 order.service 在 order.create 后回填）
   * 注意：不 increment promotion.usedCount（已在 claimCoupon 领取时占位）
   *
   * 返回 AppliedCouponDiscount；无效抛 E-COUPON-001/002/004/005
   */
  async applyCoupon(
    userCouponId: string,
    userId: string,
    totalAmount: number,
    deliveryFee: number,
    tx?: Tx,
  ): Promise<AppliedCouponDiscount> {
    const client = tx ?? db;
    const uc = await client.userCoupon.findUnique({
      where: { id: userCouponId },
      include: { promotion: true },
    });
    // 不存在或不归属当前用户 -> E-COUPON-001（404，不泄漏存在性）
    if (!uc || uc.userId !== userId) {
      throw new NotFoundException({
        code: 'E-COUPON-001',
        message: 'Coupon not found or does not belong to you',
      });
    }
    // 状态校验：USED / EXPIRED / (UNUSED 但模板已过期) -> E-COUPON-002
    const now = new Date();
    if (uc.status === 'USED') {
      throw new ConflictException({ code: 'E-COUPON-002', message: 'Coupon already used' });
    }
    if (uc.status === 'EXPIRED' || uc.promotion.endAt < now) {
      throw new ConflictException({ code: 'E-COUPON-002', message: 'Coupon has expired' });
    }
    // 模板状态（运营暂停）-> E-COUPON-004
    if (uc.promotion.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'E-COUPON-004',
        message: 'Coupon template is not active',
      });
    }
    // 门槛校验 -> E-COUPON-005
    if (totalAmount < uc.promotion.minOrderAmount) {
      throw new BadRequestException({
        code: 'E-COUPON-005',
        message: `Order amount does not meet minimum ${uc.promotion.minOrderAmount}`,
      });
    }

    const discountAmount = this.computeDiscount(uc.promotion, totalAmount, deliveryFee);

    // 标记 USED（orderId 由 order.service 在 order.create 后回填）
    await client.userCoupon.update({
      where: { id: uc.id },
      data: { status: 'USED', usedAt: now },
    });

    logger.info({
      msg: 'COUPON_APPLIED',
      userCouponId: uc.id,
      promotionId: uc.promotionId,
      code: uc.code,
      userId,
      discountAmount,
    });

    return {
      userCouponId: uc.id,
      promotionId: uc.promotionId,
      code: uc.code,
      type: uc.promotion.type,
      discountAmount,
    };
  }

  /**
   * 过期扫描（BullMQ 每 5min 调）
   *
   * 把 UNUSED 且 promotion.endAt<now 的 UserCoupon 标记为 EXPIRED。
   * 幂等：updateMany 只影响 UNUSED 行，已 EXPIRED/USED 不动。
   */
  async expireStaleCoupons(): Promise<{ expired: number }> {
    const now = new Date();
    const result = await db.userCoupon.updateMany({
      where: { status: 'UNUSED', promotion: { endAt: { lt: now } } },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) {
      logger.info({ msg: 'COUPONS_EXPIRED', count: result.count });
    }
    return { expired: result.count };
  }

  /** 校验模板可领（claim/redeem 用）：ACTIVE + 有效期内 + 配额未满 -> 否则 E-COUPON-004 */
  private assertTemplateClaimable(promo: {
    status: PromotionStatusValue;
    startAt: Date;
    endAt: Date;
    totalQuota: number | null;
    usedCount: number;
  }): void {
    if (promo.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'E-COUPON-004',
        message: 'Coupon template is not active',
      });
    }
    const now = new Date();
    if (now < promo.startAt || now > promo.endAt) {
      throw new ConflictException({
        code: 'E-COUPON-004',
        message: 'Coupon template is not within valid period',
      });
    }
    if (promo.totalQuota !== null && promo.usedCount >= promo.totalQuota) {
      throw new ConflictException({
        code: 'E-COUPON-004',
        message: 'Coupon quota exhausted',
      });
    }
  }

  /** UserCoupon row -> MyCouponView（status 按行派生：UNUSED+endAt<now 视为 expired） */
  private toMyCouponView(uc: {
    id: string;
    promotionId: string;
    code: string;
    status: 'UNUSED' | 'USED' | 'EXPIRED';
    receivedAt: Date;
    usedAt: Date | null;
    orderId: string | null;
    promotion: {
      type: PromotionTypeValue;
      value: number;
      minOrderAmount: number;
      maxDiscountAmount: number | null;
      name: string;
      description: string | null;
      startAt: Date;
      endAt: Date;
    };
  }): MyCouponView {
    const now = new Date();
    let derived: 'unused' | 'used' | 'expired';
    if (uc.status === 'USED') {
      derived = 'used';
    } else if (uc.status === 'EXPIRED' || uc.promotion.endAt < now) {
      derived = 'expired';
    } else {
      derived = 'unused';
    }
    return {
      id: uc.id,
      promotionId: uc.promotionId,
      code: uc.code,
      status: derived,
      type: uc.promotion.type,
      value: uc.promotion.value,
      minOrderAmount: uc.promotion.minOrderAmount,
      maxDiscountAmount: uc.promotion.maxDiscountAmount,
      name: uc.promotion.name,
      description: uc.promotion.description,
      startAt: uc.promotion.startAt.toISOString(),
      endAt: uc.promotion.endAt.toISOString(),
      receivedAt: uc.receivedAt.toISOString(),
      usedAt: uc.usedAt ? uc.usedAt.toISOString() : null,
      orderId: uc.orderId,
    };
  }

  /** 计算折扣金额（分） */
  private computeDiscount(
    promo: { type: PromotionTypeValue; value: number; maxDiscountAmount: number | null },
    totalAmount: number,
    deliveryFee: number,
  ): number {
    let discount = 0;
    if (promo.type === 'PERCENTAGE') {
      discount = Math.round((totalAmount * promo.value) / 100);
      if (promo.maxDiscountAmount !== null && discount > promo.maxDiscountAmount) {
        discount = promo.maxDiscountAmount;
      }
    } else if (promo.type === 'FIXED_AMOUNT') {
      discount = Math.min(promo.value, totalAmount);
    } else if (promo.type === 'FREE_DELIVERY') {
      discount = deliveryFee;
    }
    return Math.max(0, discount);
  }

  /** 入参校验 */
  private validateInput(input: CreatePromotionInput): void {
    const code = input.code.trim();
    if (code.length < 3 || code.length > 20 || !/^[A-Z0-9]+$/.test(code.toUpperCase())) {
      throw new BadRequestException({
        code: 'E-PROMO-014',
        message: 'Code must be 3-20 alphanumeric chars',
      });
    }
    if (!input.name.trim()) {
      throw new BadRequestException({ code: 'E-PROMO-015', message: 'Name is required' });
    }
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
      throw new BadRequestException({ code: 'E-PROMO-016', message: 'Invalid date format' });
    }
    if (startAt >= endAt) {
      throw new BadRequestException({ code: 'E-PROMO-004', message: 'endAt must be after startAt' });
    }
    this.validateValue(input.type, input.value);
  }

  private validateValue(type: PromotionTypeValue, value: number): void {
    if (type === 'PERCENTAGE') {
      if (!Number.isInteger(value) || value < 1 || value > 100) {
        throw new BadRequestException({
          code: 'E-PROMO-017',
          message: 'PERCENTAGE value must be integer 1-100',
        });
      }
    } else if (type === 'FIXED_AMOUNT') {
      if (!Number.isInteger(value) || value < 1) {
        throw new BadRequestException({
          code: 'E-PROMO-018',
          message: 'FIXED_AMOUNT value must be positive integer (cents)',
        });
      }
    } else if (type === 'FREE_DELIVERY') {
      if (value !== 0) {
        throw new BadRequestException({
          code: 'E-PROMO-019',
          message: 'FREE_DELIVERY value must be 0',
        });
      }
    }
  }

  /** Prisma row -> API view */
  private toView(r: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    type: PromotionTypeValue;
    value: number;
    minOrderAmount: number;
    maxDiscountAmount: number | null;
    totalQuota: number | null;
    usedCount: number;
    perUserLimit: number;
    startAt: Date;
    endAt: Date;
    status: PromotionStatusValue;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  }): PromotionView {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      type: r.type,
      value: r.value,
      minOrderAmount: r.minOrderAmount,
      maxDiscountAmount: r.maxDiscountAmount,
      totalQuota: r.totalQuota,
      usedCount: r.usedCount,
      perUserLimit: r.perUserLimit,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** Prisma row -> 客户端优惠券视图（status 由调用方按 available/used/expired 传入） */
  private toClientCouponView(
    r: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      type: PromotionTypeValue;
      value: number;
      minOrderAmount: number;
      maxDiscountAmount: number | null;
      startAt: Date;
      endAt: Date;
    },
    status: 'available' | 'used' | 'expired' = 'available',
  ): ClientCouponView {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      type: r.type,
      value: r.value,
      minOrderAmount: r.minOrderAmount,
      maxDiscountAmount: r.maxDiscountAmount,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status,
    };
  }
}
