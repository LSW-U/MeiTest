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

    it('Happy path -> code 转大写 + create', async () => {
      mockDb.promotion.findUnique.mockResolvedValue(null);
      mockDb.promotion.create.mockResolvedValue(basePromo);

      const result = await service.create({
        code: 'save10',
        name: '10% Off',
        type: 'PERCENTAGE',
        value: 10,
        startAt: '2026-07-01T00:00:00.000Z',
        endAt: '2026-07-31T23:59:59.000Z',
      });

      expect(mockDb.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ code: 'SAVE10' }),
      }));
      expect(result.code).toBe('SAVE10');
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
});
