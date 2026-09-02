/**
 * AdminDepositService 单测（批 C，2026-09-02）
 *
 * 覆盖（任务书批 C 验收）：
 *   - tiers CRUD：create 校验（maxOrderAmount ≤ minAmount 拒 / P2002 撞档转 101）/
 *     update 合并校验 / delete 软停用 / 不存在 102
 *   - locations CRUD：create / update / delete 软停用 / 不存在 103
 *   - requests 列表：status 过滤 + 分页参数透传
 *   - confirm：PENDING→CONFIRMED 事务累加（confirmedAmount ?? requestedAmount）/
 *     重复 confirm 拒 104 / 事务内 0 行并发兜底 104 / confirmedAmount < 100 拒
 *   - reject：REJECTED + adminNote / 非 PENDING 拒 104 / 并发 0 行拒 104
 *   - 聚合详情：并行查询组装 ①-⑤ / 不存在 E-RIDER-001
 *   - warehouse-load：pendingTask groupBy + 在线骑手 × 工作仓匹配 + estWait 计算
 *
 * mock：db（tier/location/deposit/profile/task/settlement/withdrawal/warehouse）+ redis + withTransaction
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis, mockWithTransaction, mockEligibility } = vi.hoisted(() => ({
  mockDb: {
    riderDepositTier: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    depositLocation: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    riderDeposit: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
    riderProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    deliveryTask: {
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    settlement: {
      aggregate: vi.fn(),
    },
    withdrawalRequest: {
      aggregate: vi.fn(),
    },
    warehouse: {
      findMany: vi.fn(),
    },
  },
  mockRedis: {
    pipeline: vi.fn(),
  },
  mockWithTransaction: vi.fn(),
  // 批D审查 P3-1：tier CRUD 后清档位缓存的 mock
  mockEligibility: {
    clearTierCache: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb, withTransaction: mockWithTransaction }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

import { AdminDepositService } from '../src/modules/rider/admin-deposit.service';

function buildTier(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tier-1',
    minAmount: 1000,
    maxOrderAmount: 10000,
    sortOrder: 3,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDeposit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dep-1',
    riderId: 'rider-1',
    channel: 'OFFLINE_COD',
    requestedAmount: 5000,
    confirmedAmount: null,
    status: 'PENDING',
    locationId: 'loc-1',
    note: null,
    adminNote: null,
    createdAt: new Date(),
    paidAt: null,
    confirmedAt: null,
    rider: { riderName: 'Alice', phone: '+670123' },
    location: { name: 'Dili Office' },
    ...overrides,
  };
}

describe('AdminDepositService', () => {
  let service: AdminDepositService;

  beforeEach(() => {
    service = new AdminDepositService(mockEligibility as never);
    Object.values(mockDb.riderDepositTier).forEach((fn) => fn.mockReset());
    Object.values(mockDb.depositLocation).forEach((fn) => fn.mockReset());
    Object.values(mockDb.riderDeposit).forEach((fn) => fn.mockReset());
    Object.values(mockDb.riderProfile).forEach((fn) => fn.mockReset());
    Object.values(mockDb.deliveryTask).forEach((fn) => fn.mockReset());
    mockDb.settlement.aggregate.mockReset();
    mockDb.withdrawalRequest.aggregate.mockReset();
    mockDb.warehouse.findMany.mockReset();
    mockRedis.pipeline.mockReset();
    mockWithTransaction.mockReset();
    mockEligibility.clearTierCache.mockReset();
  });

  describe('tiers CRUD', () => {
    it('create：maxOrderAmount ≤ minAmount → 400', async () => {
      await expect(
        service.createTier({ minAmount: 1000, maxOrderAmount: 1000, sortOrder: 1 }),
      ).rejects.toThrow(/must be greater than minAmount/);
    });

    it('create：maxOrderAmount = null（不限）→ 通过', async () => {
      mockDb.riderDepositTier.create.mockResolvedValue(buildTier({ maxOrderAmount: null }));
      const tier = await service.createTier({ minAmount: 5000, maxOrderAmount: null, sortOrder: 4 });
      expect(tier.maxOrderAmount).toBeNull();
    });

    it('create：minAmount 撞档 P2002 → E-DEPOSIT-101', async () => {
      mockDb.riderDepositTier.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      await expect(
        service.createTier({ minAmount: 1000, maxOrderAmount: 10000, sortOrder: 1 }),
      ).rejects.toThrow(/already exists/);
    });

    it('update：合并后校验（只改 minAmount 致 maxOrder ≤ min）→ 400', async () => {
      mockDb.riderDepositTier.findUnique.mockResolvedValue(buildTier({ minAmount: 1000, maxOrderAmount: 10000 }));
      await expect(service.updateTier('tier-1', { minAmount: 20000 })).rejects.toThrow(
        /must be greater than minAmount/,
      );
    });

    it('update：合法局部编辑 → 通过且不改 depositAmount（派生，无回填）', async () => {
      mockDb.riderDepositTier.findUnique.mockResolvedValue(buildTier());
      mockDb.riderDepositTier.update.mockResolvedValue(buildTier({ maxOrderAmount: 20000 }));
      const tier = await service.updateTier('tier-1', { maxOrderAmount: 20000 });
      expect(tier.maxOrderAmount).toBe(20000);
      // 方案核心：改档位绝不触碰 rider_profiles.deposit_amount
      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
    });

    it('delete：软停用 enabled=false（不物理删）', async () => {
      mockDb.riderDepositTier.findUnique.mockResolvedValue(buildTier());
      mockDb.riderDepositTier.update.mockResolvedValue(buildTier({ enabled: false }));
      const result = await service.deleteTier('tier-1');
      expect(result.enabled).toBe(false);
      expect(mockDb.riderDepositTier.update).toHaveBeenCalledWith({
        where: { id: 'tier-1' },
        data: { enabled: false },
      });
    });

    it('update/delete：档位不存在 → E-DEPOSIT-102', async () => {
      mockDb.riderDepositTier.findUnique.mockResolvedValue(null);
      await expect(service.updateTier('tier-x', { enabled: false })).rejects.toThrow(/Tier not found/);
      await expect(service.deleteTier('tier-x')).rejects.toThrow(/Tier not found/);
    });

    it('P3-1 修复：create/update/delete 成功后清档位缓存（停用档立即回落，不吃 60s 旧缓存）', async () => {
      // create 成功 → 清缓存
      mockDb.riderDepositTier.create.mockResolvedValue(buildTier({ id: 'tier-new' }));
      await service.createTier({ minAmount: 2000, maxOrderAmount: 20000, sortOrder: 5 });
      expect(mockEligibility.clearTierCache).toHaveBeenCalledTimes(1);

      // update 成功 → 清缓存
      mockDb.riderDepositTier.findUnique.mockResolvedValue(buildTier());
      mockDb.riderDepositTier.update.mockResolvedValue(buildTier({ enabled: false }));
      await service.updateTier('tier-1', { enabled: false });
      expect(mockEligibility.clearTierCache).toHaveBeenCalledTimes(2);

      // delete（软停用）成功 → 清缓存
      await service.deleteTier('tier-1');
      expect(mockEligibility.clearTierCache).toHaveBeenCalledTimes(3);
    });

    it('P3-1：校验失败路径（400/404/409）不清缓存', async () => {
      // maxOrderAmount ≤ minAmount → 400，未触 create
      await expect(
        service.createTier({ minAmount: 1000, maxOrderAmount: 1000, sortOrder: 1 }),
      ).rejects.toThrow();
      // 不存在 → 404
      mockDb.riderDepositTier.findUnique.mockResolvedValue(null);
      await expect(service.deleteTier('tier-x')).rejects.toThrow();
      expect(mockEligibility.clearTierCache).not.toHaveBeenCalled();
    });
  });

  describe('P3-1 端到端语义：改档后 isEligible 立即生效（真缓存，非 mock）', () => {
    it('停用档 → clearTierCache → getEnabledTiers 回源新档列表 → 派生回落', async () => {
      const { DepositEligibilityService: Real, setTierCacheForTest } = await import(
        '../src/modules/rider/deposit-eligibility.service'
      );
      const real = new Real();
      // 预热缓存：$10 档在列（deposit 2000 → 上限 10000）
      setTierCacheForTest([
        { id: 't3', minAmount: 1000, maxOrderAmount: 10000 },
        { id: 't2', minAmount: 500, maxOrderAmount: 5000 },
      ]);
      const before = real.deriveEligibility('r1', 2000, await real.getEnabledTiers());
      expect(before.maxOrderAmount).toBe(10000);

      // admin 停用 t3（deleteTier 内部已 mock 验证调用；这里直接验真服务语义）
      real.clearTierCache();
      // DB 回源返回新档列表（t3 已停用）
      mockDb.riderDepositTier.findMany.mockResolvedValue([{ id: 't2', minAmount: 500, maxOrderAmount: 5000 }]);
      const after = real.deriveEligibility('r1', 2000, await real.getEnabledTiers());
      expect(after.maxOrderAmount).toBe(5000); // 立即回落，无 60s 窗口
    });
  });

  describe('locations CRUD', () => {
    it('create → 落库 enabled 默认 true', async () => {
      mockDb.depositLocation.create.mockResolvedValue({ id: 'loc-2', enabled: true });
      await service.createLocation({ name: 'Suai Office', address: 'Suai' });
      expect(mockDb.depositLocation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Suai Office', enabled: true }),
      });
    });

    it('update：不存在 → E-DEPOSIT-103', async () => {
      mockDb.depositLocation.findUnique.mockResolvedValue(null);
      await expect(service.updateLocation('loc-x', { enabled: false })).rejects.toThrow(/not found/);
    });

    it('delete：软停用', async () => {
      mockDb.depositLocation.findUnique.mockResolvedValue({ id: 'loc-1', enabled: true });
      mockDb.depositLocation.update.mockResolvedValue({ id: 'loc-1', enabled: false });
      const result = await service.deleteLocation('loc-1');
      expect(result.enabled).toBe(false);
    });
  });

  describe('requests 列表', () => {
    it('status 过滤 + 分页（page=2/pageSize=10 → skip 10 take 10）', async () => {
      mockDb.riderDeposit.findMany.mockResolvedValue([]);
      mockDb.riderDeposit.count.mockResolvedValue(15);

      const result = await service.listRequests({ status: 'PENDING', page: 2, pageSize: 10 });

      expect(mockDb.riderDeposit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PENDING' }, skip: 10, take: 10 }),
      );
      expect(result.total).toBe(15);
      expect(result.page).toBe(2);
    });

    it('无 status → where 空（全量）+ 默认分页 1/20', async () => {
      mockDb.riderDeposit.findMany.mockResolvedValue([]);
      mockDb.riderDeposit.count.mockResolvedValue(0);

      await service.listRequests({});

      expect(mockDb.riderDeposit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {}, skip: 0, take: 20 }),
      );
    });
  });

  describe('confirm（事务累加幂等）', () => {
    it('PENDING → CONFIRMED：累加 confirmedAmount ?? requestedAmount', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit());
      const confirmed = buildDeposit({ status: 'CONFIRMED', confirmedAmount: 4500, confirmedAt: new Date() });
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(confirmed),
        },
        riderProfile: { update: vi.fn().mockResolvedValue({}) },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));
      mockDb.riderProfile.findUniqueOrThrow.mockResolvedValue({ depositAmount: 4500 });

      const result = await service.confirm('dep-1', { confirmedAmount: 4500, adminNote: '实收 $45' });

      expect(result.deposit.status).toBe('CONFIRMED');
      expect(result.depositAmount).toBe(4500);
      // 修正金额生效（4500 而非 requestedAmount 5000）+ adminNote 落库
      expect(tx.riderDeposit.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ confirmedAmount: 4500, adminNote: '实收 $45' }) }),
      );
      expect(tx.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { depositAmount: { increment: 4500 } },
      });
    });

    it('不传 confirmedAmount → 用 requestedAmount', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit());
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(buildDeposit({ status: 'CONFIRMED', confirmedAmount: 5000 })),
        },
        riderProfile: { update: vi.fn() },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));
      mockDb.riderProfile.findUniqueOrThrow.mockResolvedValue({ depositAmount: 5000 });

      await service.confirm('dep-1', {});
      expect(tx.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { depositAmount: { increment: 5000 } },
      });
    });

    it('幂等：已 CONFIRMED 再 confirm → E-DEPOSIT-104 拒绝（不进事务）', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ status: 'CONFIRMED' }));
      await expect(service.confirm('dep-1', {})).rejects.toThrow(/only PENDING can be confirmed/);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it('并发兜底：事务内 updateMany 0 行（另一方已处理）→ 104 不重复累加', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit());
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: vi.fn(),
        },
        riderProfile: { update: vi.fn() },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));

      await expect(service.confirm('dep-1', {})).rejects.toThrow(/concurrent confirm rejected/);
      expect(tx.riderProfile.update).not.toHaveBeenCalled();
    });

    it('confirmedAmount < 100 → 400', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit());
      await expect(service.confirm('dep-1', { confirmedAmount: 50 })).rejects.toThrow(/>= 100/);
    });

    it('不存在 → E-DEPOSIT-006', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(null);
      await expect(service.confirm('dep-x', {})).rejects.toThrow(/not found/);
    });
  });

  /** 链式 pipeline mock：exists(...).exec()（聚合详情）与 pipeline.exists(); pipeline.exec()（warehouse-load）两种用法都兼容 */
  function chainPipeline(results: Array<[null, number]> | Error) {
    const exec = Array.isArray(results)
      ? vi.fn().mockResolvedValue(results)
      : vi.fn().mockRejectedValue(results);
    return { exists: vi.fn().mockReturnThis(), exec };
  }

  /** reject 正常路径的 mock 序列（入口校验 + updateMany 后重读） */
  function mockRejectFlow(rejected: Record<string, unknown>): void {
    mockDb.riderDeposit.findUnique
      .mockResolvedValueOnce(buildDeposit()) // 入口 PENDING 校验
      .mockResolvedValueOnce(rejected); // updateMany 后 findUniqueOrThrow
    mockDb.riderDeposit.findUniqueOrThrow.mockResolvedValue(rejected);
    mockDb.riderDeposit.updateMany.mockResolvedValue({ count: 1 });
  }

  describe('reject', () => {
    it('PENDING → REJECTED + adminNote 落库（骑手端可见）', async () => {
      mockRejectFlow(buildDeposit({ status: 'REJECTED', adminNote: '金额对不上' }));

      const result = await service.reject('dep-1', { adminNote: '金额对不上' });

      expect(result.status).toBe('REJECTED');
      expect(result.adminNote).toBe('金额对不上');
      expect(mockDb.riderDeposit.updateMany).toHaveBeenCalledWith({
        where: { id: 'dep-1', status: 'PENDING' },
        data: { status: 'REJECTED', adminNote: '金额对不上' },
      });
    });

    it('非 PENDING（CONFIRMED）→ 104', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ status: 'CONFIRMED' }));
      await expect(service.reject('dep-1', { adminNote: 'x' })).rejects.toThrow(/only PENDING can be rejected/);
    });

    it('并发 0 行（与 confirm 竞争失败）→ 104', async () => {
      mockDb.riderDeposit.findUnique.mockResolvedValueOnce(buildDeposit());
      mockDb.riderDeposit.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.reject('dep-1', { adminNote: 'x' })).rejects.toThrow(/concurrent update rejected/);
    });
  });

  describe('聚合详情（Q8 ①-⑤）', () => {
    it('并行查询组装：basic/realtime/stats/finance/depositRequests', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue({
        id: 'rider-1',
        userId: 'user-1',
        riderName: 'Alice',
        phone: '+670123',
        vehicleType: 'MOTORCYCLE',
        vehiclePlate: 'TD-001',
        status: 'OFFLINE',
        applicationStatus: 'APPROVED',
        preferredWarehouseIds: ['wh-1'],
        totalDeliveries: 42,
        rating: { toNumber: () => 4.8 } as unknown as number,
        depositAmount: 2000,
        user: { id: 'user-1' },
      });
      mockDb.deliveryTask.count
        .mockResolvedValueOnce(2) // activeTasks
        .mockResolvedValueOnce(5); // todayDeliveries
      mockDb.riderDeposit.findMany.mockResolvedValue([buildDeposit()]);
      mockDb.settlement.aggregate.mockResolvedValue({ _sum: { netAmount: 10000 } });
      mockDb.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: 3000 } });
      mockDb.riderDepositTier.findFirst.mockResolvedValue(buildTier({ minAmount: 1000, maxOrderAmount: 10000 }));
      // redis pipeline：exists(...).exec() 链式 → [[null, 1]]（在线）
      mockRedis.pipeline.mockReturnValue(chainPipeline([[null, 1]]));

      const detail = await service.getRiderDepositDetail('rider-1');

      expect(detail.basic.riderProfileId).toBe('rider-1');
      expect(detail.basic.applicationStatus).toBe('APPROVED');
      expect(detail.realtime.isOnline).toBe(true);
      expect(detail.realtime.activeTaskCount).toBe(2);
      expect(detail.stats.todayDeliveries).toBe(5);
      expect(detail.stats.totalDeliveries).toBe(42);
      expect(detail.finance.depositAmount).toBe(2000);
      expect(detail.finance.maxOrderAmount).toBe(10000);
      expect(detail.finance.settleBalance).toBe(7000); // 10000 - 3000
      expect(detail.depositRequests).toHaveLength(1);
    });

    it('不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(service.getRiderDepositDetail('rider-x')).rejects.toThrow(/not found/);
    });

    it('Redis 故障 → isOnline=false 降级不抛错', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue({
        id: 'rider-1',
        userId: 'user-1',
        status: 'ONLINE',
        rating: 5,
        depositAmount: 0,
        preferredWarehouseIds: [],
        applicationStatus: 'APPROVED',
        user: { id: 'user-1' },
      });
      mockDb.deliveryTask.count.mockResolvedValue(0);
      mockDb.riderDeposit.findMany.mockResolvedValue([]);
      mockDb.settlement.aggregate.mockResolvedValue({ _sum: { netAmount: null } });
      mockDb.withdrawalRequest.aggregate.mockResolvedValue({ _sum: { amount: null } });
      mockDb.riderDepositTier.findFirst.mockResolvedValue(null);
      mockRedis.pipeline.mockReturnValue(chainPipeline(new Error('ECONNREFUSED')));

      const detail = await service.getRiderDepositDetail('rider-1');
      expect(detail.realtime.isOnline).toBe(false);
      expect(detail.finance.settleBalance).toBe(0); // null ?? 0
    });
  });

  describe('warehouse-load', () => {
    it('每仓 pending/available/estWait（工作仓匹配 + 在线过滤）', async () => {
      mockDb.warehouse.findMany.mockResolvedValue([
        { id: 'wh-1', code: 'W01', name: { en: 'Dili Central' } },
        { id: 'wh-2', code: 'W02', name: { en: 'Baucau' } },
      ]);
      mockDb.deliveryTask.groupBy.mockResolvedValue([
        { warehouseId: 'wh-1', _count: { _all: 4 } },
        { warehouseId: 'wh-2', _count: { _all: 0 } },
      ]);
      mockDb.riderProfile.findMany.mockResolvedValue([
        { id: 'rider-1', userId: 'u1', preferredWarehouseIds: ['wh-1'] }, // 在线 + wh-1
        { id: 'rider-2', userId: 'u2', preferredWarehouseIds: ['wh-2'] }, // 离线
        { id: 'rider-3', userId: 'u3', preferredWarehouseIds: ['wh-1'] }, // 在线 + wh-1
      ]);
      // pipeline：3 个 exists → 只有 rider-1 在线
      mockRedis.pipeline.mockReturnValue(chainPipeline([
        [null, 1],
        [null, 0],
        [null, 1],
      ]));

      const loads = await service.getWarehouseLoad();

      // P3-1 修复锁定：groupBy 只统计 ACTIVE 仓（warehouseId in 白名单）
      expect(mockDb.deliveryTask.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PENDING_ASSIGN', warehouseId: { in: ['wh-1', 'wh-2'] } },
        }),
      );
      expect(loads).toHaveLength(2);
      const wh1 = loads.find((l) => l.warehouseId === 'wh-1')!;
      expect(wh1.pendingTaskCount).toBe(4);
      expect(wh1.availableRiderCount).toBe(2); // rider-1 + rider-3（在线且工作仓含 wh-1）
      expect(wh1.estWaitMinutes).toBe(Math.ceil((4 / 2) * 30)); // 60
      const wh2 = loads.find((l) => l.warehouseId === 'wh-2')!;
      expect(wh2.availableRiderCount).toBe(0); // rider-2 离线
      expect(wh2.estWaitMinutes).toBe(0); // 0 pending
    });

    it('无仓库 → 空数组', async () => {
      mockDb.warehouse.findMany.mockResolvedValue([]);
      const loads = await service.getWarehouseLoad();
      expect(loads).toEqual([]);
    });
  });
});
