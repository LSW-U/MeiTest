/**
 * PromotionService tests (W7-ext-G)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockWithTransaction } = vi.hoisted(() => ({
  mockDb: {
    promotion: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    orderPromotion: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    userCoupon: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
  // withTransaction：把回调用 mockDb 当 tx 执行（让 tx.userCoupon.create / tx.$executeRaw 命中 mock）
  mockWithTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb)),
}));

vi.mock('../src/shared/db', () => ({ db: mockDb, withTransaction: mockWithTransaction }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { PromotionService } from '../src/modules/promotion/promotion.service';

describe('PromotionService (W7-ext-G)', () => {
  let service: PromotionService;

  beforeEach(() => {
    Object.values(mockDb.promotion).forEach((fn) => fn.mockReset());
    mockDb.orderPromotion.findMany.mockReset();
    mockDb.orderPromotion.count.mockReset();
    mockDb.orderPromotion.count.mockResolvedValue(0); // P1-1：默认未用过（perUserLimit 校验通过）
    Object.values(mockDb.userCoupon).forEach((fn) => fn.mockReset());
    mockDb.$executeRaw.mockReset();
    mockWithTransaction.mockReset();
    // 重置后恢复默认实现（把回调用 mockDb 执行）
    mockWithTransaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
    );
    // @ts-expect-error - no constructor args needed
    service = new PromotionService();
  });

  // 动态时间窗（避免硬编码日期随日历过期）——now-30d ~ now+30d，永在有效期内
  const _now = new Date();
  const basePromo = {
    id: 'promo-1',
    code: 'SAVE10',
    name: '10% Off',
    description: null,
    type: 'PERCENTAGE' as const,
    value: 10,
    minOrderAmount: 1000,
    maxDiscountAmount: 500,
    totalQuota: 100,
    usedCount: 5,
    perUserLimit: 1,
    startAt: new Date(_now.getTime() - 30 * 24 * 60 * 60 * 1000),
    endAt: new Date(_now.getTime() + 30 * 24 * 60 * 60 * 1000),
    status: 'ACTIVE' as const,
    createdBy: 'admin-1',
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
  };

  describe('list', () => {
    it('返回列表 + keyword OR 筛选', async () => {
      mockDb.promotion.findMany.mockResolvedValue([basePromo]);

      const result = await service.list({ keyword: 'SAVE' });

      expect(mockDb.promotion.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { code: { contains: 'SAVE' } },
            { name: { contains: 'SAVE' } },
          ]),
        }),
        take: 50,
      }));
      expect(result).toHaveLength(1);
    });

    it('limit 上限 100', async () => {
      mockDb.promotion.findMany.mockResolvedValue([]);
      await service.list({ limit: 500 });
      expect(mockDb.promotion.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    });
  });

  describe('detail', () => {
    it('不存在 -> E-PROMO-001', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(null);
      await expect(service.detail('x')).rejects.toMatchObject({
        response: { code: 'E-PROMO-001' },
        status: 404,
      });
    });
  });

  describe('create', () => {
    it('code 重复 -> E-PROMO-002', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      await expect(
        service.create({
          code: 'SAVE10',
          name: 'Test',
          type: 'PERCENTAGE',
          value: 10,
          startAt: '2026-07-01T00:00:00.000Z',
          endAt: '2026-07-31T23:59:59.000Z',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-002' }, status: 409 });
    });

    it('code 非法字符 -> E-PROMO-014', async () => {
      await expect(
        service.create({
          code: 'ab!', // 非字母数字
          name: 'Test',
          type: 'PERCENTAGE',
          value: 10,
          startAt: '2026-07-01T00:00:00.000Z',
          endAt: '2026-07-31T23:59:59.000Z',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-014' }, status: 400 });
    });

    it('PERCENTAGE value 超范围 -> E-PROMO-017', async () => {
      await expect(
        service.create({
          code: 'SAVE200',
          name: 'Test',
          type: 'PERCENTAGE',
          value: 200,
          startAt: '2026-07-01T00:00:00.000Z',
          endAt: '2026-07-31T23:59:59.000Z',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-017' }, status: 400 });
    });

    it('endAt <= startAt -> E-PROMO-004', async () => {
      await expect(
        service.create({
          code: 'SAVE10',
          name: 'Test',
          type: 'PERCENTAGE',
          value: 10,
          startAt: '2026-07-31T00:00:00.000Z',
          endAt: '2026-07-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-004' }, status: 400 });
    });

    it('Happy path -> code 转大写 + create + 写 createdBy', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(null);
      mockDb.promotion.create.mockResolvedValue(basePromo);

      const result = await service.create({
        code: 'save10',
        name: '10% Off',
        type: 'PERCENTAGE',
        value: 10,
        startAt: '2026-07-01T00:00:00.000Z',
        endAt: '2026-07-31T23:59:59.000Z',
        createdBy: 'admin-42',
      });

      expect(mockDb.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ code: 'SAVE10', createdBy: 'admin-42' }),
      }));
      expect(result.code).toBe('SAVE10');
      expect(result.createdBy).toBe('admin-1');
    });
  });

  describe('activate / pause / remove', () => {
    it('activate DELETED -> E-PROMO-005', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, status: 'DELETED' });
      await expect(service.activate('promo-1')).rejects.toMatchObject({
        response: { code: 'E-PROMO-005' },
        status: 409,
      });
    });

    it('activate 已 ACTIVE -> E-PROMO-006', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      await expect(service.activate('promo-1')).rejects.toMatchObject({
        response: { code: 'E-PROMO-006' },
        status: 409,
      });
    });

    it('pause 非 ACTIVE -> E-PROMO-007', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, status: 'PAUSED' });
      await expect(service.pause('promo-1')).rejects.toMatchObject({
        response: { code: 'E-PROMO-007' },
        status: 409,
      });
    });

    it('remove 已 DELETED -> E-PROMO-008', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, status: 'DELETED' });
      await expect(service.remove('promo-1')).rejects.toMatchObject({
        response: { code: 'E-PROMO-008' },
        status: 409,
      });
    });

    it('pause Happy path -> update status PAUSED', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      mockDb.promotion.update.mockResolvedValue({ ...basePromo, status: 'PAUSED' });
      const result = await service.pause('promo-1');
      expect(mockDb.promotion.update).toHaveBeenCalledWith({
        where: { id: 'promo-1' },
        data: { status: 'PAUSED' },
      });
      expect(result.status).toBe('PAUSED');
    });
  });

  describe('applyPromotion', () => {
    it('码不存在 -> E-PROMO-009', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(null);
      await expect(
        service.applyPromotion('NOPE', 'user-1', 2000, 500),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-009' }, status: 400 });
    });

    it('非 ACTIVE -> E-PROMO-010', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, status: 'PAUSED' });
      await expect(
        service.applyPromotion('SAVE10', 'user-1', 2000, 500),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-010' }, status: 400 });
    });

    it('未到开始时间 -> E-PROMO-011', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        startAt: new Date('2099-01-01T00:00:00.000Z'),
        endAt: new Date('2099-12-31T00:00:00.000Z'),
      });
      await expect(
        service.applyPromotion('SAVE10', 'user-1', 2000, 500),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-011' }, status: 400 });
    });

    it('未达 minOrderAmount -> E-PROMO-012', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      await expect(
        service.applyPromotion('SAVE10', 'user-1', 500, 500), // minOrder=1000
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-012' }, status: 400 });
    });

    it('配额用完（$executeRaw 影响 0 行）-> E-PROMO-013 / 409', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      mockDb.$executeRaw.mockResolvedValue(0);
      await expect(
        service.applyPromotion('SAVE10', 'user-1', 2000, 500),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-013' }, status: 409 });
    });

    it('perUserLimit 达上限 -> E-PROMO-020（P1-1，不 increment usedCount）', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, perUserLimit: 1 });
      mockDb.orderPromotion.count.mockResolvedValueOnce(1); // 已用 1 次 = perUserLimit
      mockDb.$executeRaw.mockResolvedValue(1);
      await expect(
        service.applyPromotion('SAVE10', 'user-1', 2000, 500),
      ).rejects.toMatchObject({ response: { code: 'E-PROMO-020' }, status: 400 });
      // perUserLimit 校验在 $executeRaw increment 前，不应扣配额
      expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    });

    it('PERCENTAGE Happy path -> discount = totalAmount * value / 100，受 maxDiscountAmount 上限', async () => {
      // totalAmount=2000, value=10% -> 200，未超 maxDiscount=500 -> discount=200
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      mockDb.$executeRaw.mockResolvedValue(1);

      const result = await service.applyPromotion('SAVE10', 'user-1', 2000, 500);

      expect(result.discountAmount).toBe(200);
      expect(result.type).toBe('PERCENTAGE');
      expect(mockDb.$executeRaw).toHaveBeenCalled();
    });

    it('PERCENTAGE 超 maxDiscount -> 截断到 maxDiscount', async () => {
      // totalAmount=10000, value=10% -> 1000，超 maxDiscount=500 -> discount=500
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      mockDb.$executeRaw.mockResolvedValue(1);

      const result = await service.applyPromotion('SAVE10', 'user-1', 10000, 500);
      expect(result.discountAmount).toBe(500);
    });

    it('FIXED_AMOUNT -> min(value, totalAmount)', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        type: 'FIXED_AMOUNT' as const,
        value: 300,
        maxDiscountAmount: null,
      });
      mockDb.$executeRaw.mockResolvedValue(1);

      // totalAmount=2000 -> discount=300
      const r1 = await service.applyPromotion('SAVE10', 'user-1', 2000, 500);
      expect(r1.discountAmount).toBe(300);
    });

    it('FIXED_AMOUNT 超 totalAmount -> 截断到 totalAmount', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        type: 'FIXED_AMOUNT' as const,
        value: 5000,
        maxDiscountAmount: null,
      });
      mockDb.$executeRaw.mockResolvedValue(1);

      // totalAmount=2000 -> discount=2000
      const r = await service.applyPromotion('SAVE10', 'user-1', 2000, 500);
      expect(r.discountAmount).toBe(2000);
    });

    it('FREE_DELIVERY -> discount = deliveryFee', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        type: 'FREE_DELIVERY' as const,
        value: 0,
        maxDiscountAmount: null,
      });
      mockDb.$executeRaw.mockResolvedValue(1);

      const r = await service.applyPromotion('SAVE10', 'user-1', 2000, 500);
      expect(r.discountAmount).toBe(500);
    });
  });

  describe('validatePromotion (P1-3)', () => {
    it('码不存在 -> valid=false / INVALID_CODE', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(null);
      const r = await service.validatePromotion('NOPE', 2000, 500);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('INVALID_CODE');
      expect(r.discount).toBe(0);
    });

    it('非 ACTIVE -> NOT_ACTIVE', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, status: 'PAUSED' });
      const r = await service.validatePromotion('SAVE10', 2000, 500);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('NOT_ACTIVE');
    });

    it('未到时间 -> NOT_IN_PERIOD', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        startAt: new Date('2099-01-01T00:00:00.000Z'),
        endAt: new Date('2099-12-31T00:00:00.000Z'),
      });
      const r = await service.validatePromotion('SAVE10', 2000, 500);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('NOT_IN_PERIOD');
    });

    it('未达 minOrder -> BELOW_MIN_ORDER', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      const r = await service.validatePromotion('SAVE10', 500, 500);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('BELOW_MIN_ORDER');
    });

    it('配额用完 -> QUOTA_EXHAUSTED', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({ ...basePromo, totalQuota: 100, usedCount: 100 });
      const r = await service.validatePromotion('SAVE10', 2000, 500);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('QUOTA_EXHAUSTED');
    });

    it('PERCENTAGE Happy path -> valid=true + discount 正确 + 不 increment', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(basePromo);
      // totalAmount=2000, value=10% -> 200，未超 maxDiscount=500
      const r = await service.validatePromotion('SAVE10', 2000, 500);
      expect(r.valid).toBe(true);
      expect(r.discount).toBe(200);
      expect(r.type).toBe('PERCENTAGE');
      // validate 是只读预览，不 increment usedCount
      expect(mockDb.$executeRaw).not.toHaveBeenCalled();
    });

    it('FREE_DELIVERY -> discount = deliveryFee', async () => {
      mockDb.promotion.findUnique.mockResolvedValue({
        ...basePromo,
        type: 'FREE_DELIVERY' as const,
        value: 0,
        maxDiscountAmount: null,
      });
      const r = await service.validatePromotion('SAVE10', 2000, 500);
      expect(r.valid).toBe(true);
      expect(r.discount).toBe(500);
    });
  });

  // listClientCoupons describe 已删除（C4，2026-08-13）：方法零调用已删，单测同步删

  // ==========================================================================
  // P1 领券卡包体系（UserCoupon 维度，2026-07-31）
  // ==========================================================================
  describe('P1 领券卡包体系', () => {
    const promoRow = {
      ...basePromo,
      startAt: new Date('2026-01-01T00:00:00.000Z'),
      endAt: new Date('2099-12-31T00:00:00.000Z'),
    };

    describe('listAvailableTemplates', () => {
      it('返 ACTIVE + 有效期内 + 未超额，排除当前用户已领（NOT userCoupons.some userId）', async () => {
        mockDb.promotion.findMany.mockResolvedValue([promoRow]);
        const result = await service.listAvailableTemplates('user-1');
        expect(result).toHaveLength(1);
        expect(result[0].status).toBe('available');
        expect(mockDb.promotion.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: 'ACTIVE',
              NOT: { userCoupons: { some: { userId: 'user-1' } } },
            }),
          }),
        );
      });

      it('超额（usedCount >= totalQuota）-> 内存过滤掉', async () => {
        mockDb.promotion.findMany.mockResolvedValue([
          { ...promoRow, usedCount: 100, totalQuota: 100 },
        ]);
        const result = await service.listAvailableTemplates('user-1');
        expect(result).toHaveLength(0);
      });
    });

    describe('claimCoupon', () => {
      it('模板不存在 -> E-COUPON-004 / 404', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(null);
        await expect(service.claimCoupon('p-x', 'user-1')).rejects.toMatchObject({
          response: { code: 'E-COUPON-004' },
          status: 404,
        });
      });

      it('模板非 ACTIVE -> E-COUPON-004 / 409', async () => {
        mockDb.promotion.findUnique.mockResolvedValue({ ...promoRow, status: 'PAUSED' });
        await expect(service.claimCoupon('p-1', 'user-1')).rejects.toMatchObject({
          response: { code: 'E-COUPON-004' },
          status: 409,
        });
      });

      it('配额已满（$executeRaw 影响 0 行）-> E-COUPON-004 / 409', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(promoRow);
        mockDb.userCoupon.create.mockResolvedValue({ id: 'uc-1', promotion: promoRow });
        mockDb.$executeRaw.mockResolvedValue(0);
        await expect(service.claimCoupon('p-1', 'user-1')).rejects.toMatchObject({
          response: { code: 'E-COUPON-004' },
          status: 409,
        });
      });

      it('Happy path -> create UserCoupon(UNUSED) + increment usedCount + 返 MyCoupon', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(promoRow);
        const createdUc = {
          id: 'uc-1',
          promotionId: 'promo-1',
          code: 'SAVE10',
          status: 'UNUSED',
          receivedAt: new Date('2026-07-31T00:00:00Z'),
          usedAt: null,
          orderId: null,
          promotion: promoRow,
        };
        mockDb.userCoupon.create.mockResolvedValue(createdUc);
        mockDb.$executeRaw.mockResolvedValue(1);

        const result = await service.claimCoupon('p-1', 'user-1');

        expect(mockDb.userCoupon.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              userId: 'user-1',
              promotionId: 'promo-1',
              code: 'SAVE10',
              status: 'UNUSED',
            }),
          }),
        );
        // 原子 increment 配额守卫
        expect(mockDb.$executeRaw).toHaveBeenCalled();
        expect(result.id).toBe('uc-1');
        expect(result.status).toBe('available');
      });

      it('重复领取（P2002 unique 冲突）-> E-COUPON-003 / 409', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(promoRow);
        const p2002 = new (class extends Error {
          code = 'P2002';
        })();
        // 模拟 PrismaClientKnownRequestError 形态（instanceof 校验在 service 内）
        const { Prisma } = await import('../src/prisma/client');
        Object.setPrototypeOf(p2002, Prisma.PrismaClientKnownRequestError.prototype);
        mockDb.userCoupon.create.mockRejectedValue(p2002);
        mockDb.$executeRaw.mockResolvedValue(1);

        await expect(service.claimCoupon('p-1', 'user-1')).rejects.toMatchObject({
          response: { code: 'E-COUPON-003' },
          status: 409,
        });
      });
    });

    describe('redeemCoupon', () => {
      it('码不存在 -> E-COUPON-004 / 400', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(null);
        await expect(service.redeemCoupon('NOPE', 'user-1')).rejects.toMatchObject({
          response: { code: 'E-COUPON-004' },
          status: 400,
        });
      });

      it('Happy path -> 按 code 大写找模板后 claim', async () => {
        mockDb.promotion.findUnique.mockResolvedValue(promoRow); // claimCoupon 内再查一次 by id
        mockDb.userCoupon.create.mockResolvedValue({
          id: 'uc-2',
          promotionId: 'promo-1',
          code: 'SAVE10',
          status: 'UNUSED',
          receivedAt: new Date('2026-07-31T00:00:00Z'),
          usedAt: null,
          orderId: null,
          promotion: promoRow,
        });
        mockDb.$executeRaw.mockResolvedValue(1);

        const result = await service.redeemCoupon('save10', 'user-1');

        // findUnique 被 code（大写）查
        expect(mockDb.promotion.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({ where: { code: 'SAVE10' } }),
        );
        expect(result.id).toBe('uc-2');
        expect(result.status).toBe('available');
      });
    });

    describe('listMyCoupons', () => {
      const ucRow = {
        id: 'uc-1',
        promotionId: 'promo-1',
        code: 'SAVE10',
        status: 'UNUSED',
        receivedAt: new Date('2026-07-31T00:00:00Z'),
        usedAt: null,
        orderId: null,
        promotion: promoRow,
      };

      it('available -> where 含 status=UNUSED + promotion.endAt>=now', async () => {
        mockDb.userCoupon.findMany.mockResolvedValue([ucRow]);
        const result = await service.listMyCoupons('user-1', 'available');
        expect(mockDb.userCoupon.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              userId: 'user-1',
              status: 'UNUSED',
              promotion: { endAt: { gte: expect.any(Date) } },
            }),
          }),
        );
        expect(result[0].status).toBe('available');
      });

      it('used -> where status=USED，行派生 status=used', async () => {
        mockDb.userCoupon.findMany.mockResolvedValue([
          { ...ucRow, status: 'USED', usedAt: new Date('2026-07-31T10:00:00Z'), orderId: 'o-1' },
        ]);
        const result = await service.listMyCoupons('user-1', 'used');
        expect(mockDb.userCoupon.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ status: 'USED' }) }),
        );
        expect(result[0].status).toBe('used');
        expect(result[0].orderId).toBe('o-1');
      });

      it('expired -> where OR（EXPIRED 或 UNUSED+endAt<now）', async () => {
        mockDb.userCoupon.findMany.mockResolvedValue([
          { ...ucRow, status: 'EXPIRED' },
        ]);
        const result = await service.listMyCoupons('user-1', 'expired');
        expect(mockDb.userCoupon.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.arrayContaining([
                { status: 'EXPIRED' },
                { status: 'UNUSED', promotion: { endAt: { lt: expect.any(Date) } } },
              ]),
            }),
          }),
        );
        expect(result[0].status).toBe('expired');
      });

      it('UNUSED 但模板已过期（定时任务未跑）-> 派生 expired（查询兜底）', async () => {
        mockDb.userCoupon.findMany.mockResolvedValue([
          { ...ucRow, promotion: { ...promoRow, endAt: new Date('2020-01-01T00:00:00Z') } },
        ]);
        const result = await service.listMyCoupons('user-1');
        expect(result[0].status).toBe('expired');
      });
    });

    describe('applyCoupon', () => {
      const ucWithPromo = {
        id: 'uc-1',
        userId: 'user-1',
        promotionId: 'promo-1',
        code: 'SAVE10',
        status: 'UNUSED',
        promotion: promoRow,
      };

      it('不存在 -> E-COUPON-001 / 404', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue(null);
        await expect(service.applyCoupon('uc-x', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-001' },
          status: 404,
        });
      });

      it('不归属当前用户 -> E-COUPON-001 / 404（不泄漏存在性）', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue({ ...ucWithPromo, userId: 'other' });
        await expect(service.applyCoupon('uc-1', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-001' },
          status: 404,
        });
      });

      it('已用（status=USED）-> E-COUPON-002 / 409', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue({ ...ucWithPromo, status: 'USED' });
        await expect(service.applyCoupon('uc-1', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-002' },
          status: 409,
        });
      });

      it('已过期（endAt<now）-> E-COUPON-002 / 409', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue({
          ...ucWithPromo,
          promotion: { ...promoRow, endAt: new Date('2020-01-01T00:00:00Z') },
        });
        await expect(service.applyCoupon('uc-1', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-002' },
          status: 409,
        });
      });

      it('模板暂停 -> E-COUPON-004 / 409', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue({
          ...ucWithPromo,
          promotion: { ...promoRow, status: 'PAUSED' },
        });
        await expect(service.applyCoupon('uc-1', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-004' },
          status: 409,
        });
      });

      it('未达 minOrderAmount -> E-COUPON-005 / 400', async () => {
        // promoRow.minOrderAmount=1000，传 500
        mockDb.userCoupon.findUnique.mockResolvedValue(ucWithPromo);
        await expect(service.applyCoupon('uc-1', 'user-1', 500, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-005' },
          status: 400,
        });
      });

      it('Happy path -> 原子标 USED（updateMany WHERE UNUSED）+ 返 discount（不 increment，已在 claim 占位）', async () => {
        mockDb.userCoupon.findUnique.mockResolvedValue(ucWithPromo);
        mockDb.userCoupon.updateMany.mockResolvedValue({ count: 1 });
        // totalAmount=2000, PERCENTAGE 10% -> 200
        const result = await service.applyCoupon('uc-1', 'user-1', 2000, 500);
        expect(mockDb.userCoupon.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'uc-1', status: 'UNUSED' },
            data: expect.objectContaining({ status: 'USED', usedAt: expect.any(Date) }),
          }),
        );
        expect(result.discountAmount).toBe(200);
        expect(result.userCouponId).toBe('uc-1');
        // applyCoupon 不 increment promotion.usedCount
        expect(mockDb.$executeRaw).not.toHaveBeenCalled();
      });

      it('并发双用券（updateMany count=0）-> E-COUPON-002 / 409（防 TOCTOU 双抵扣）', async () => {
        // 读快照是 UNUSED（通过 status 检查），但原子翻转时已被并发抢先（count=0）
        mockDb.userCoupon.findUnique.mockResolvedValue(ucWithPromo);
        mockDb.userCoupon.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.applyCoupon('uc-1', 'user-1', 2000, 500)).rejects.toMatchObject({
          response: { code: 'E-COUPON-002' },
          status: 409,
        });
      });
    });

    describe('expireStaleCoupons', () => {
      it('updateMany where=UNUSED+promotion.endAt<now -> EXPIRED，返 count', async () => {
        mockDb.userCoupon.updateMany.mockResolvedValue({ count: 7 });
        const result = await service.expireStaleCoupons();
        expect(mockDb.userCoupon.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              status: 'UNUSED',
              promotion: { endAt: { lt: expect.any(Date) } },
            }),
            data: { status: 'EXPIRED' },
          }),
        );
        expect(result.expired).toBe(7);
      });

      it('无过期 -> count=0', async () => {
        mockDb.userCoupon.updateMany.mockResolvedValue({ count: 0 });
        const result = await service.expireStaleCoupons();
        expect(result.expired).toBe(0);
      });
    });
  });

});
