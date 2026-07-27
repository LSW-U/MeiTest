/**
 * Review Service tests (reviews-2)
 *
 * 重点覆盖（方案 §八 8.3）：
 * - F2: COD 四送达态可评论（DELIVERED/DELIVERED_PAID/DELIVERED_UNPAID/COMPLETED），非送达态拒
 * - 一次评论 E-REVIEW-003 / 无权 E-REVIEW-005 / 订单不存在 E-REVIEW-001
 * - F6: 无骑手 E-REVIEW-004 + 锁当前骑手
 * - F4: rating 全量重算（Decimal 2 位精度，无 APPROVED 评价重置 5.00）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockTx, mockWithTransaction } = vi.hoisted(() => {
  const mockDb = {
    order: { findUnique: vi.fn() },
    review: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    riderReview: {
      findUnique: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      aggregate: vi.fn(),
    },
    riderProfile: { update: vi.fn() },
  };
  // 事务 client 复用 db 的 mock（简化：withTransaction 回调用同一组 mock）
  const mockTx = mockDb;
  const mockWithTransaction = vi.fn(
    async (cb: (tx: typeof mockDb) => Promise<unknown>) => cb(mockTx),
  );
  return { mockDb, mockTx, mockWithTransaction };
});

vi.mock('../src/shared/db', () => ({ db: mockDb, withTransaction: mockWithTransaction }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ReviewService } from '../src/modules/review/review.service';

describe('ReviewService (reviews-2)', () => {
  let service: ReviewService;

  beforeEach(() => {
    Object.values(mockDb).forEach((t) => Object.values(t).forEach((fn) => fn.mockReset()));
    mockWithTransaction.mockReset();
    mockWithTransaction.mockImplementation(async (cb) => cb(mockTx));
    // @ts-expect-error ReviewService 无构造依赖（用全局 db），可直接实例化
    service = new ReviewService();
  });

  describe('createReview - F2 COD 四送达态可评', () => {
    const baseOrder = {
      id: 'o1',
      userId: 'u1',
      status: 'DELIVERED',
      user: { id: 'u1', name: 'Alice', avatarUrl: null },
      items: [{ productId: 'p1' }],
    };
    const input = {
      userId: 'u1',
      orderId: 'o1',
      rating: 5,
      content: { en: 'good' },
      images: [],
      category: 'PRODUCT' as const,
    };
    const createdReview = {
      id: 'r1',
      orderId: 'o1',
      userId: 'u1',
      userName: 'Alice',
      avatarUrl: null,
      rating: 5,
      content: { en: 'good' },
      images: [],
      status: 'APPROVED',
      category: 'PRODUCT',
      reply: null,
      repliedAt: null,
      productId: null,
      createdAt: new Date('2026-07-28T00:00:00Z'),
    };

    it('DELIVERED 可评 + status APPROVED', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED' });
      mockDb.review.findUnique.mockResolvedValue(null);
      mockDb.review.create.mockResolvedValue(createdReview);
      const r = await service.createReview(input);
      expect(r.status).toBe('APPROVED');
      expect(mockDb.review.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
    });

    it('DELIVERED_PAID（COD 已收款）可评 —— F2 关键', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED_PAID' });
      mockDb.review.findUnique.mockResolvedValue(null);
      mockDb.review.create.mockResolvedValue(createdReview);
      await service.createReview(input);
      expect(mockDb.review.create).toHaveBeenCalled();
    });

    it('DELIVERED_UNPAID（COD 拒付）可评', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED_UNPAID' });
      mockDb.review.findUnique.mockResolvedValue(null);
      mockDb.review.create.mockResolvedValue(createdReview);
      await service.createReview(input);
      expect(mockDb.review.create).toHaveBeenCalled();
    });

    it('COMPLETED 可评', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'COMPLETED' });
      mockDb.review.findUnique.mockResolvedValue(null);
      mockDb.review.create.mockResolvedValue(createdReview);
      await service.createReview(input);
      expect(mockDb.review.create).toHaveBeenCalled();
    });

    it('CONFIRMED 未送达 -> E-REVIEW-002', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'CONFIRMED' });
      await expect(service.createReview(input)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-002' },
        status: 409,
      });
    });

    it('PENDING_CONFIRM 未送达 -> E-REVIEW-002', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'PENDING_CONFIRM' });
      await expect(service.createReview(input)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-002' },
        status: 409,
      });
    });

    it('订单不存在 -> E-REVIEW-001 (404)', async () => {
      mockDb.order.findUnique.mockResolvedValue(null);
      await expect(service.createReview(input)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-001' },
        status: 404,
      });
    });

    it('非本人订单 -> E-REVIEW-005 (403)', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, userId: 'other' });
      await expect(service.createReview(input)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-005' },
        status: 403,
      });
    });

    it('重复评论 -> E-REVIEW-003 (409)', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED' });
      mockDb.review.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.createReview(input)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-003' },
        status: 409,
      });
    });

    it('productId 不在订单 -> E-COMMON-001 (400)', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED' });
      mockDb.review.findUnique.mockResolvedValue(null);
      await expect(
        service.createReview({ ...input, productId: 'p-not-in-order' }),
      ).rejects.toMatchObject({ response: { code: 'E-COMMON-001' }, status: 400 });
    });
  });

  describe('createRiderReview - F6 锁当前骑手', () => {
    const baseInput = { userId: 'u1', orderId: 'o1', rating: 5, tags: ['on_time'] };

    it('订单无骑手 -> E-REVIEW-004 (409)', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        id: 'o1',
        userId: 'u1',
        status: 'DELIVERED',
        riderId: null,
        user: { id: 'u1', name: 'A' },
      });
      mockDb.riderReview.findUnique.mockResolvedValue(null);
      await expect(service.createRiderReview(baseInput)).rejects.toMatchObject({
        response: { code: 'E-REVIEW-004' },
        status: 409,
      });
    });

    it('happy -> 事务写评价 + 重算骑手 rating', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        id: 'o1',
        userId: 'u1',
        status: 'DELIVERED',
        riderId: 'rdr1',
        user: { id: 'u1', name: 'A' },
      });
      mockDb.riderReview.findUnique.mockResolvedValue(null);
      mockTx.riderReview.create.mockResolvedValue({
        id: 'rr1',
        orderId: 'o1',
        riderId: 'rdr1',
        userId: 'u1',
        userName: 'A',
        rating: 5,
        tags: ['on_time'],
        comment: null,
        status: 'APPROVED',
        createdAt: new Date('2026-07-28T00:00:00Z'),
      });
      mockTx.riderReview.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: 2 });

      const r = await service.createRiderReview(baseInput);

      expect(r.id).toBe('rr1');
      expect(mockWithTransaction).toHaveBeenCalled();
      expect(mockTx.riderReview.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ riderId: 'rdr1' }) }),
      );
      // 重算用 APPROVED 集合
      expect(mockTx.riderReview.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { riderId: 'rdr1', status: 'APPROVED' } }),
      );
      expect(mockTx.riderProfile.update).toHaveBeenCalled();
    });
  });

  describe('recalcRiderRating - F4 Decimal 精度', () => {
    it('avg 4.333 -> Decimal 4.33', async () => {
      mockDb.riderReview.aggregate.mockResolvedValue({ _avg: { rating: 4.33333 }, _count: 3 });
      mockDb.riderProfile.update.mockResolvedValue({});
      await service.recalcRiderRating('rdr1');
      const arg = mockDb.riderProfile.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'rdr1' });
      expect(arg.data.rating.toString()).toBe('4.33');
    });

    it('无 APPROVED 评价 -> 重置 5.00', async () => {
      mockDb.riderReview.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: 0 });
      mockDb.riderProfile.update.mockResolvedValue({});
      await service.recalcRiderRating('rdr1');
      const arg = mockDb.riderProfile.update.mock.calls[0][0];
      expect(arg.data.rating.toString()).toBe('5');
    });
  });

  describe('adminListReviews - type 区分两表', () => {
    it('customer -> db.review.findMany', async () => {
      mockDb.review.findMany.mockResolvedValue([]);
      mockDb.review.count.mockResolvedValue(0);
      await service.adminListReviews({ type: 'customer' });
      expect(mockDb.review.findMany).toHaveBeenCalled();
      expect(mockDb.riderReview.findMany).not.toHaveBeenCalled();
    });

    it('rider -> db.riderReview.findMany', async () => {
      mockDb.riderReview.findMany.mockResolvedValue([]);
      mockDb.riderReview.count.mockResolvedValue(0);
      await service.adminListReviews({ type: 'rider' });
      expect(mockDb.riderReview.findMany).toHaveBeenCalled();
      expect(mockDb.review.findMany).not.toHaveBeenCalled();
    });
  });

  describe('adminDeleteReview - 删骑手评价后重算 rating', () => {
    it('rider 删除 -> recalc', async () => {
      mockDb.riderReview.findUnique.mockResolvedValue({ id: 'rr1', riderId: 'rdr1' });
      mockDb.riderReview.delete.mockResolvedValue({});
      mockDb.riderReview.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: 0 });
      mockDb.riderProfile.update.mockResolvedValue({});
      await service.adminDeleteReview('rr1', 'rider');
      expect(mockDb.riderReview.delete).toHaveBeenCalledWith({ where: { id: 'rr1' } });
      expect(mockDb.riderProfile.update).toHaveBeenCalled();
    });

    it('customer 删除 -> 不调 recalc', async () => {
      mockDb.review.findUnique.mockResolvedValue({ id: 'r1' });
      mockDb.review.delete.mockResolvedValue({});
      await service.adminDeleteReview('r1', 'customer');
      expect(mockDb.review.delete).toHaveBeenCalled();
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
    });
  });
});
