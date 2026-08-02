/**
 * PromotionService tests (W7-ext-G)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
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
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
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
    mockDb.$executeRaw.mockReset();
    // @ts-expect-error - no constructor args needed
    service = new PromotionService();
  });

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
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: new Date('2026-07-31T23:59:59.000Z'),
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

  describe('listClientCoupons (B10 + used/expired)', () => {
    it('available（默认）-> ACTIVE + 有效期内 + 未超额，status=available', async () => {
      mockDb.promotion.findMany.mockResolvedValue([basePromo]);
      const result = await service.listClientCoupons('available', 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('available');
      expect(mockDb.orderPromotion.findMany).not.toHaveBeenCalled();
    });

    it('available 未传 status -> 默认 available（向后兼容）', async () => {
      mockDb.promotion.findMany.mockResolvedValue([basePromo]);
      const result = await service.listClientCoupons();
      expect(result[0].status).toBe('available');
    });

    it('available 超额（usedCount >= totalQuota）-> 过滤掉', async () => {
      mockDb.promotion.findMany.mockResolvedValue([{ ...basePromo, usedCount: 100, totalQuota: 100 }]);
      const result = await service.listClientCoupons('available', 'user-1');
      expect(result).toHaveLength(0);
    });

    it('used -> OrderPromotion JOIN + 去重 + 按最近使用 desc 排序，status=used', async () => {
      mockDb.orderPromotion.findMany.mockResolvedValue([
        { promotionId: 'promo-1', createdAt: new Date('2026-07-28T00:00:00Z') },
        { promotionId: 'promo-2', createdAt: new Date('2026-07-29T00:00:00Z') },
        { promotionId: 'promo-1', createdAt: new Date('2026-07-20T00:00:00Z') }, // promo-1 旧记录（去重）
      ]);
      mockDb.promotion.findMany.mockResolvedValue([
        { ...basePromo, id: 'promo-1' },
        { ...basePromo, id: 'promo-2', code: 'SAVE20' },
      ]);

      const result = await service.listClientCoupons('used', 'user-1');

      expect(result).toHaveLength(2);
      // promo-2 最近使用（7-29）排在 promo-1（7-28）前
      expect(result.map((x) => x.id)).toEqual(['promo-2', 'promo-1']);
      expect(result[0].status).toBe('used');
      expect(mockDb.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['promo-1', 'promo-2'] }, status: { not: 'DELETED' } }),
        }),
      );
    });

    it('used 无记录 -> 空数组', async () => {
      mockDb.orderPromotion.findMany.mockResolvedValue([]);
      const result = await service.listClientCoupons('used', 'user-1');
      expect(result).toEqual([]);
    });

    it('used 不传 userId -> 空数组（不查 DB）', async () => {
      const result = await service.listClientCoupons('used');
      expect(result).toEqual([]);
      expect(mockDb.orderPromotion.findMany).not.toHaveBeenCalled();
    });

    it('expired（E2：我用过且过期）-> endAt<now 过滤，status=expired', async () => {
      const pastPromo = { ...basePromo, id: 'promo-old', endAt: new Date('2020-01-01T00:00:00Z') };
      mockDb.orderPromotion.findMany.mockResolvedValue([
        { promotionId: 'promo-old', createdAt: new Date('2019-01-01T00:00:00Z') },
        { promotionId: 'promo-1', createdAt: new Date('2026-07-28T00:00:00Z') },
      ]);
      // DB where 含 endAt<now 过滤，mock 只返过期的
      mockDb.promotion.findMany.mockResolvedValue([pastPromo]);

      const result = await service.listClientCoupons('expired', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('promo-old');
      expect(result[0].status).toBe('expired');
      expect(mockDb.promotion.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: { in: ['promo-old', 'promo-1'] },
            endAt: { lt: expect.any(Date) },
          }),
        }),
      );
    });
  });

});
