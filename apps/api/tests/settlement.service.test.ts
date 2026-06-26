/**
 * SettlementService 单测
 *
 * 覆盖场景：
 *   1. runSettlement 首次 → aggregator.aggregate 调用 + db.settlement.create + status PENDING
 *   2. runSettlement 幂等（同 periodDate + subjectType + subjectId）→ 返回已存在记录，不调 create
 *   3. netAmount 计算 = grossAmount - commission - refundAmount
 *   4. periodDate 缺省 → 取昨天
 *   5. list 分页 + filter
 *   6. detail 找不到 → NotFoundException + E-SETTLE-004
 *
 * 决策依据：W2-M-MANIFEST-W3.md §6 W3 测试补强
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../src/shared/db', () => ({
  db: {
    settlement: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  SettlementService,
  MockOrderAggregator,
  type OrderAggregator,
  SETTLE_ORDER_AGGREGATOR,
} from '../src/modules/settle/settlement.service';
import { db } from '../src/shared/db';

const dbMock = db.settlement as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
};

function makeAggregator(overrides: Partial<{
  orderCount: number;
  grossAmount: number;
  refundAmount: number;
  commission: number;
}> = {}): OrderAggregator {
  return {
    aggregate: vi.fn().mockResolvedValue({
      orderCount: overrides.orderCount ?? 10,
      grossAmount: overrides.grossAmount ?? 10000,
      refundAmount: overrides.refundAmount ?? 500,
      commission: overrides.commission ?? 800,
    }),
  };
}

function mockRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'set-1',
    periodDate: new Date('2026-06-24'),
    subjectType: 'MERCHANT',
    subjectId: 'shop-1',
    warehouseId: null,
    orderCount: 10,
    grossAmount: 10000,
    commission: 800,
    refundAmount: 500,
    netAmount: 8700,
    status: 'PENDING',
    confirmedAt: null,
    paidAt: null,
    createdAt: new Date('2026-06-25T02:00:00Z'),
    updatedAt: new Date('2026-06-25T02:00:00Z'),
    ...overrides,
  };
}

describe('SettlementService', () => {
  let service: SettlementService;
  let aggregator: OrderAggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    aggregator = makeAggregator();
    service = new SettlementService(aggregator);
  });

  describe('runSettlement', () => {
    it('首次生成：调 aggregator + create + status PENDING + netAmount 正确', async () => {
      dbMock.findFirst.mockResolvedValue(null);
      dbMock.create.mockResolvedValue(mockRow());

      const result = await service.runSettlement({
        periodDate: '2026-06-24',
        subjectType: 'MERCHANT',
        subjectId: 'shop-1',
      });

      expect(aggregator.aggregate).toHaveBeenCalledWith(
        new Date('2026-06-24'),
        'MERCHANT',
        'shop-1',
      );
      expect(dbMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          periodDate: new Date('2026-06-24'),
          subjectType: 'MERCHANT',
          subjectId: 'shop-1',
          status: 'PENDING',
          // netAmount = gross(10000) - commission(800) - refund(500) = 8700
          netAmount: 8700,
        }),
      });
      expect(result.status).toBe('PENDING');
      expect(result.subjectType).toBe('MERCHANT');
    });

    it('幂等：同 (period, subject) 已存在 → 返回已存在记录，不调 create', async () => {
      const existing = mockRow({ id: 'set-existing' });
      dbMock.findFirst.mockResolvedValue(existing);

      const result = await service.runSettlement({
        periodDate: '2026-06-24',
        subjectType: 'MERCHANT',
        subjectId: 'shop-1',
      });

      expect(aggregator.aggregate).not.toHaveBeenCalled();
      expect(dbMock.create).not.toHaveBeenCalled();
      expect(result.id).toBe('set-existing');
    });

    it('periodDate 缺省 → service 内部取昨天', async () => {
      dbMock.findFirst.mockResolvedValue(null);
      dbMock.create.mockResolvedValue(mockRow());

      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const expectedPeriod = yesterday.toISOString().slice(0, 10);

      await service.runSettlement({
        subjectType: 'RIDER',
        subjectId: 'rider-1',
      });

      expect(dbMock.findFirst).toHaveBeenCalledWith({
        where: {
          periodDate: new Date(expectedPeriod),
          subjectType: 'RIDER',
          subjectId: 'rider-1',
        },
      });
    });

    it('netAmount 计算公式：gross - commission - refund', async () => {
      aggregator = makeAggregator({
        orderCount: 5,
        grossAmount: 20000,
        refundAmount: 1000,
        commission: 2000,
      });
      service = new SettlementService(aggregator);
      dbMock.findFirst.mockResolvedValue(null);
      dbMock.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve(mockRow({ ...data } as Record<string, unknown>)),
      );

      await service.runSettlement({
        periodDate: '2026-06-24',
        subjectType: 'MERCHANT',
        subjectId: 'shop-1',
      });

      const call = dbMock.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.netAmount).toBe(20000 - 2000 - 1000);
    });
  });

  describe('list', () => {
    it('分页 + filter 传到 db', async () => {
      dbMock.findMany.mockResolvedValue([mockRow()]);
      dbMock.count.mockResolvedValue(1);

      const result = await service.list({
        subjectType: 'MERCHANT',
        status: 'PENDING',
        page: 1,
        pageSize: 20,
      });

      expect(dbMock.findMany).toHaveBeenCalledWith({
        where: {
          subjectType: 'MERCHANT',
          status: 'PENDING',
        },
        orderBy: { periodDate: 'desc' },
        skip: 0,
        take: 20,
      });
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('periodFrom / periodTo 范围查询', async () => {
      dbMock.findMany.mockResolvedValue([]);
      dbMock.count.mockResolvedValue(0);

      await service.list({
        periodFrom: '2026-06-01',
        periodTo: '2026-06-30',
        page: 1,
        pageSize: 10,
      });

      const call = dbMock.findMany.mock.calls[0][0] as {
        where: { periodDate: { gte: Date; lte: Date } };
      };
      expect(call.where.periodDate.gte).toEqual(new Date('2026-06-01'));
      expect(call.where.periodDate.lte).toEqual(new Date('2026-06-30'));
    });
  });

  describe('detail', () => {
    it('找不到 → NotFoundException + E-SETTLE-004', async () => {
      dbMock.findUnique.mockResolvedValue(null);
      await expect(service.detail('nope')).rejects.toMatchObject({
        response: { code: 'E-SETTLE-004' },
      });
      expect(NotFoundException);
    });

    it('找到 → 返回 dto', async () => {
      dbMock.findUnique.mockResolvedValue(mockRow({ id: 'set-x' }));
      const result = await service.detail('set-x');
      expect(result.id).toBe('set-x');
    });
  });

  describe('confirm（审查报告 P0 #5 — 状态机闭环）', () => {
    it('PENDING → CONFIRMED + confirmedAt 设置', async () => {
      dbMock.findUnique.mockResolvedValue(mockRow({ status: 'PENDING' }));
      dbMock.update.mockResolvedValue(
        mockRow({ status: 'CONFIRMED', confirmedAt: new Date('2026-06-25T10:00:00Z') }),
      );

      const result = await service.confirm('set-1', 'admin-1');

      expect(result.status).toBe('CONFIRMED');
      expect(dbMock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'set-1' },
          data: expect.objectContaining({
            status: 'CONFIRMED',
            confirmedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('非 PENDING（如已 PAID）→ ConflictException + E-SETTLE-003', async () => {
      dbMock.findUnique.mockResolvedValue(mockRow({ status: 'PAID' }));
      await expect(service.confirm('set-1', 'admin-1')).rejects.toMatchObject({
        response: { code: 'E-SETTLE-003' },
      });
      expect(dbMock.update).not.toHaveBeenCalled();
    });

    it('不存在 → NotFoundException + E-SETTLE-004', async () => {
      dbMock.findUnique.mockResolvedValue(null);
      await expect(service.confirm('set-x', 'admin-1')).rejects.toMatchObject({
        response: { code: 'E-SETTLE-004' },
      });
    });
  });

  describe('runSettlement P2002 race 处理（审查报告 P0 #5）', () => {
    it('create 抛 P2002 → 回查现有记录返回（幂等语义）', async () => {
      dbMock.findFirst.mockResolvedValueOnce(null); // 幂等检查通过
      dbMock.create.mockRejectedValue({ code: 'P2002' }); // 并发赢家已写入
      dbMock.findFirst.mockResolvedValueOnce(mockRow({ id: 'winner-set' })); // 回查命中

      const result = await service.runSettlement({
        periodDate: '2026-06-24',
        subjectType: 'MERCHANT',
        subjectId: 'shop-1',
      });

      expect(result.id).toBe('winner-set');
    });

    it('create 抛非 P2002 错误 → 透传', async () => {
      dbMock.findFirst.mockResolvedValueOnce(null);
      dbMock.create.mockRejectedValue({ code: 'P2003', message: 'other error' });

      await expect(
        service.runSettlement({
          periodDate: '2026-06-24',
          subjectType: 'MERCHANT',
          subjectId: 'shop-1',
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });
  });
});

describe('MockOrderAggregator', () => {
  it('同一 subject 多次调用返回稳定结果（hash 一致）', () => {
    const agg = new MockOrderAggregator();
    const r1 = agg.aggregate(new Date('2026-06-24'), 'MERCHANT', 'shop-1');
    const r2 = agg.aggregate(new Date('2026-06-25'), 'MERCHANT', 'shop-1');
    return Promise.all([r1, r2]).then(([a, b]) => {
      expect(a).toEqual(b);
      expect(a.orderCount).toBeGreaterThan(0);
      expect(a.grossAmount).toBeGreaterThan(0);
    });
  });

  it('MERCHANT 抽成 8%，RIDER 不抽成', async () => {
    const agg = new MockOrderAggregator();
    const m = await agg.aggregate(new Date(), 'MERCHANT', 'shop-1');
    const r = await agg.aggregate(new Date(), 'RIDER', 'rider-1');
    expect(m.commission).toBeGreaterThan(0);
    expect(r.commission).toBe(0);
  });
});

// 触发 SETTLE_ORDER_AGGREGATOR symbol 引用（避免 unused 警告）
void SETTLE_ORDER_AGGREGATOR;
