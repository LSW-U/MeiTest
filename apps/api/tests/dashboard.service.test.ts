/**
 * DashboardService 单测（m5 修复）
 *
 * 重点验证：
 *   - GMV_ORDER_STATUSES 不含 DELIVERED_UNPAID（M2 修复）
 *   - countAbnormalOrders 加 range（M1 修复）
 *   - aggregateWarehouseBreakdown 缺 warehouse 时的 warn + filter
 *   - getSummary 整体流程（6 个并行查询 + 增长率）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({
  Prisma: {
    // Prisma.raw 在生产代码里返回 SQL 片段包装对象，测试里只需要确保不抛错
    raw: (s: string) => s,
  },
}));

vi.mock('../src/shared/db', () => ({
  db: {
    order: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    warehouse: { findMany: vi.fn() },
    // $queryRaw 是 tagged template，mock 成返回空数组的函数
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

// P0-2 修复后 countOnlineRiders 改查 Redis（rider:online:* keys）
vi.mock('../src/shared/cache', () => ({
  redis: {
    keys: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DashboardService } from '../src/modules/platform/dashboard.service';
import { db } from '../src/shared/db';

const dbMock = db as unknown as {
  order: {
    groupBy: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  warehouse: { findMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

// P0-2: redis mock for countOnlineRiders
import { redis } from '../src/shared/cache';
const redisMock = redis as unknown as { keys: ReturnType<typeof vi.fn> };

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DashboardService();
  });

  describe('GMV_ORDER_STATUSES 排除规则（M2 修复）', () => {
    it('GMV 聚合 where.status.in 不包含 DELIVERED_UNPAID', async () => {
      dbMock.order.groupBy.mockResolvedValue([]);
      redisMock.keys.mockResolvedValue([]);
      dbMock.order.count.mockResolvedValue(0);
      dbMock.warehouse.findMany.mockResolvedValue([]);

      await service.getSummary('today');

      // 第一次 groupBy 是 aggregateGmvAndOrders（current 段）
      const currentCall = dbMock.order.groupBy.mock.calls[0][0];
      expect(currentCall.where.status.in).not.toContain('DELIVERED_UNPAID');
      expect(currentCall.where.status.in).toContain('DELIVERED_PAID');
      expect(currentCall.where.status.in).toContain('COMPLETED');
    });

    it('GMV 包含 CONFIRMED / PICKED / OUT_FOR_DELIVERY / DELIVERED_PAID / DELIVERED / COMPLETED', async () => {
      dbMock.order.groupBy.mockResolvedValue([]);
      redisMock.keys.mockResolvedValue([]);
      dbMock.order.count.mockResolvedValue(0);
      dbMock.warehouse.findMany.mockResolvedValue([]);

      await service.getSummary('today');

      const call = dbMock.order.groupBy.mock.calls[0][0];
      expect(call.where.status.in).toEqual([
        'CONFIRMED',
        'PICKED',
        'OUT_FOR_DELIVERY',
        'DELIVERED_PAID',
        'DELIVERED',
        'COMPLETED',
      ]);
    });
  });

  describe('countAbnormalOrders 加 range（M1 修复）', () => {
    it('statusCount where 包含 createdAt range', async () => {
      dbMock.order.groupBy.mockResolvedValue([]);
      redisMock.keys.mockResolvedValue([]);
      dbMock.order.count.mockResolvedValue(0);
      dbMock.warehouse.findMany.mockResolvedValue([]);

      await service.getSummary('today');

      // 第 3、4 次 count 是 countAbnormalOrders 的两个并行查询
      const statusCountCall = dbMock.order.count.mock.calls[0][0];
      const timeoutCountCall = dbMock.order.count.mock.calls[1][0];

      expect(statusCountCall.where.createdAt).toBeDefined();
      expect(statusCountCall.where.createdAt.gte).toBeInstanceOf(Date);
      expect(statusCountCall.where.createdAt.lt).toBeInstanceOf(Date);
      expect(statusCountCall.where.status.in).toEqual(['CANCELLED', 'DELIVERED_UNPAID']);

      // timeout 段也带 range
      expect(timeoutCountCall.where.createdAt.gte).toBeInstanceOf(Date);
      expect(timeoutCountCall.where.createdAt.lt).toBeInstanceOf(Date);
    });
  });

  describe('aggregateWarehouseBreakdown', () => {
    it('rows 为空 → 返回空数组，不查 warehouse', async () => {
      dbMock.order.groupBy.mockResolvedValueOnce([]); // breakdown
      // 其他调用 mock 默认
      dbMock.order.groupBy.mockResolvedValue([]);
      dbMock.order.count.mockResolvedValue(0);
      redisMock.keys.mockResolvedValue([]);

      // 直接调私有方法（通过类型断言）
      const result = await (
        service as unknown as {
          aggregateWarehouseBreakdown: (from: Date, to: Date) => Promise<unknown[]>;
        }
      ).aggregateWarehouseBreakdown(new Date('2026-06-23'), new Date('2026-06-24'));

      expect(result).toEqual([]);
      expect(dbMock.warehouse.findMany).not.toHaveBeenCalled();
    });

    it('warehouse 找不到 → logger.warn + filter 掉', async () => {
      dbMock.order.groupBy
        .mockResolvedValueOnce([
          {
            warehouseId: 'wh-1',
            _sum: { payableAmount: 1000 },
            _count: { _all: 5 },
          },
          {
            warehouseId: 'wh-missing',
            _sum: { payableAmount: 500 },
            _count: { _all: 2 },
          },
        ])
        .mockResolvedValueOnce([
          // abnormal by wh
          { warehouseId: 'wh-1', _count: { _all: 1 } },
        ]);
      dbMock.warehouse.findMany.mockResolvedValue([{ id: 'wh-1', name: { en: 'WH 1' } }]);

      const result = (await (
        service as unknown as {
          aggregateWarehouseBreakdown: (from: Date, to: Date) => Promise<
            Array<{ warehouseId: string }>
          >;
        }
      ).aggregateWarehouseBreakdown(new Date('2026-06-23'), new Date('2026-06-24'))) as Array<{
        warehouseId: string;
        warehouseName: unknown;
        gmv: number;
      }>;

      // wh-missing 被 filter 掉
      expect(result).toHaveLength(1);
      expect(result[0].warehouseId).toBe('wh-1');
      expect(result[0].gmv).toBe(1000);
    });
  });

  describe('getSummary 整体流程', () => {
    it('range=today → 返回包含 from/to/gmv/orderCount/trend/warehouseBreakdown', async () => {
      dbMock.order.groupBy.mockResolvedValue([
        { status: 'COMPLETED', _sum: { payableAmount: 5000 }, _count: { _all: 10 } },
      ]);
      redisMock.keys.mockResolvedValue([1,2,3]);
      dbMock.order.count.mockResolvedValue(2);
      dbMock.warehouse.findMany.mockResolvedValue([]);
      dbMock.$queryRaw.mockResolvedValue([
        { bucket: '00:00', gmv: BigInt(1000), order_count: BigInt(2) },
      ]);

      const summary = await service.getSummary('today');

      expect(summary).toHaveProperty('from');
      expect(summary).toHaveProperty('to');
      expect(summary).toHaveProperty('gmv', 5000);
      expect(summary).toHaveProperty('orderCount', 10);
      expect(summary).toHaveProperty('onlineRiderCount', 3);
      // countAbnormalOrders 调 2 次 count（statusCount + timeoutCount），每次返回 2，加总 = 4
      expect(summary).toHaveProperty('abnormalOrderCount', 4);
      expect(summary).toHaveProperty('trend');
      expect(summary).toHaveProperty('warehouseBreakdown');
      expect(summary.trend).toHaveLength(24); // 24 个小时桶
    });

    it('GMV 增长率 prev=0 current>0 → 100', async () => {
      // current 段返回有数据，prev 段返回空
      dbMock.order.groupBy
        .mockResolvedValueOnce([
          { status: 'COMPLETED', _sum: { payableAmount: 5000 }, _count: { _all: 10 } },
        ])
        .mockResolvedValueOnce([]); // prev 段
      redisMock.keys.mockResolvedValue([]);
      dbMock.order.count.mockResolvedValue(0);
      dbMock.warehouse.findMany.mockResolvedValue([]);
      dbMock.$queryRaw.mockResolvedValue([]);

      const summary = await service.getSummary('today');
      expect(summary.gmvGrowthPct).toBe(100);
    });
  });
});
