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
import { db } from '../../shared/db';
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

    // 单用户限用：MVP 留口子不强制（W8 再接 OrderPromotion 计数）
    void userId;

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
}
