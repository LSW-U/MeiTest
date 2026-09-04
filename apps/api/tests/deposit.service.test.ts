/**
 * RiderDepositService 单测（批 B 状态机，2026-09-02）
 *
 * 覆盖（任务书批 B 验收）：
 *   - createRequest：ONLINE_MOCK 创建 PENDING / OFFLINE_COD 缺 locationId → E-DEPOSIT-002 /
 *     location 不存在或停用 → E-DEPOSIT-002 / amount < 100 → E-DEPOSIT-001（service 层兜底）
 *   - payMock：PENDING→CONFIRMED（事务内累加 depositAmount）/ 幂等（已 CONFIRMED 返回不重复累加）/
 *     非 ONLINE_MOCK → E-DEPOSIT-003 / REJECTED → E-DEPOSIT-004 / 非本人 → E-DEPOSIT-005 /
 *     不存在 → E-DEPOSIT-006
 *   - getStatus：档位派生（命中最高 minAmount ≤ depositAmount 的 enabled 档）/ 未缴 tier=null /
 *     最近 10 条申请
 *
 * mock：db（riderProfile/riderDeposit/depositLocation/riderDepositTier）+ withTransaction
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockWithTransaction } = vi.hoisted(() => ({
  mockDb: {
    riderProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    riderDeposit: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    depositLocation: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    riderDepositTier: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
  mockWithTransaction: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({ db: mockDb, withTransaction: mockWithTransaction }));

import { RiderDepositService } from '../src/modules/rider/deposit.service';

function buildProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'rider-1',
    userId: 'user-1',
    depositAmount: 0,
    ...overrides,
  };
}

function buildDeposit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'dep-1',
    riderId: 'rider-1',
    channel: 'ONLINE_MOCK',
    requestedAmount: 500,
    confirmedAmount: null,
    status: 'PENDING',
    locationId: null,
    note: null,
    adminNote: null,
    createdAt: new Date('2026-09-02T00:00:00Z'),
    paidAt: null,
    confirmedAt: null,
    ...overrides,
  };
}

describe('RiderDepositService', () => {
  let service: RiderDepositService;

    beforeEach(() => {
      service = new RiderDepositService();
      Object.values(mockDb.riderProfile).forEach((fn) => fn.mockReset());
      Object.values(mockDb.riderDeposit).forEach((fn) => fn.mockReset());
      mockDb.depositLocation.findUnique.mockReset();
      mockDb.riderDepositTier.findFirst.mockReset();
      mockWithTransaction.mockReset();
    });

  describe('createRequest PENDING 互斥（批 B 修正）', () => {
    it('同通道互斥：已有 ONLINE_MOCK PENDING → 再提 ONLINE_MOCK 被拒 E-DEPOSIT-007', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findFirst.mockResolvedValue(
        buildDeposit({ channel: 'ONLINE_MOCK', requestedAmount: 1000 }),
      );

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 500 }),
      ).rejects.toThrow(/Already has a pending deposit request/);
      expect(mockDb.riderDeposit.create).not.toHaveBeenCalled();
    });

    it('跨通道互斥：已有 OFFLINE_COD PENDING → 提 ONLINE_MOCK 被拒（提示含通道/金额）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findFirst.mockResolvedValue(
        buildDeposit({ channel: 'OFFLINE_COD', requestedAmount: 5000 }),
      );

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 1000 }),
      ).rejects.toThrow(/OFFLINE_COD, \$50\.00/);
    });

    it('REJECTED 后可重提：查 PENDING 返回 null → 正常创建新流水', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findFirst.mockResolvedValue(null); // 无 PENDING（历史 REJECTED 不算）
      mockDb.riderDeposit.create.mockResolvedValue(buildDeposit({ id: 'dep-2' }));

      const result = await service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 500 });

      expect(result.status).toBe('PENDING');
      expect(mockDb.riderDeposit.create).toHaveBeenCalled();
      // 互斥查询只查 status=PENDING（REJECTED/CONFIRMED 不影响重提）
      expect(mockDb.riderDeposit.findFirst).toHaveBeenCalledWith({
        where: { riderId: 'rider-1', status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('CONFIRMED 后可再提（累加）：查 PENDING 返回 null → 正常创建', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ depositAmount: 1000 }));
      mockDb.riderDeposit.findFirst.mockResolvedValue(null);
      mockDb.riderDeposit.create.mockResolvedValue(buildDeposit({ id: 'dep-3', requestedAmount: 1000 }));

      const result = await service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 1000 });

      expect(result.status).toBe('PENDING');
    });

    it('竞态兜底（P2-1）：findFirst 通过但 create 触发 P2002 → E-DEPOSIT-007', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findFirst.mockResolvedValue(null); // 并发下双方都通过了应用层检查
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      mockDb.riderDeposit.create.mockRejectedValue(p2002);

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 500 }),
      ).rejects.toThrow(/concurrent create rejected/);
    });

    it('P2002 以外的 create 错误原样抛出（不吞）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findFirst.mockResolvedValue(null);
      mockDb.riderDeposit.create.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 500 }),
      ).rejects.toThrow(/ECONNREFUSED/);
    });
  });

  describe('createRequest', () => {
    it('ONLINE_MOCK → 创建 PENDING（无 location）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.create.mockResolvedValue(buildDeposit({ channel: 'ONLINE_MOCK', requestedAmount: 1000 }));

      const result = await service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 1000 });

      expect(result.status).toBe('PENDING');
      expect(result.channel).toBe('ONLINE_MOCK');
      expect(mockDb.riderDeposit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          riderId: 'rider-1',
          channel: 'ONLINE_MOCK',
          requestedAmount: 1000,
          status: 'PENDING',
          locationId: null,
        }),
      });
      expect(mockDb.depositLocation.findUnique).not.toHaveBeenCalled();
    });

    it('OFFLINE_COD 缺 locationId → E-DEPOSIT-002', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'OFFLINE_COD', amount: 500 }),
      ).rejects.toThrow(/locationId is required/);
    });

    it('OFFLINE_COD location 不存在 → E-DEPOSIT-002', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.depositLocation.findUnique.mockResolvedValue(null);

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'OFFLINE_COD', amount: 500, locationId: 'loc-x' }),
      ).rejects.toThrow(/not found or disabled/);
    });

    it('OFFLINE_COD location 停用 → E-DEPOSIT-002', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.depositLocation.findUnique.mockResolvedValue({ id: 'loc-1', enabled: false });

      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'OFFLINE_COD', amount: 500, locationId: 'loc-1' }),
      ).rejects.toThrow(/not found or disabled/);
    });

    it('OFFLINE_COD 合法 location → 创建 PENDING 带 locationId', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.depositLocation.findUnique.mockResolvedValue({ id: 'loc-1', enabled: true });
      mockDb.riderDeposit.create.mockResolvedValue(
        buildDeposit({ channel: 'OFFLINE_COD', locationId: 'loc-1' }),
      );

      const result = await service.createRequest({
        riderUserId: 'user-1',
        channel: 'OFFLINE_COD',
        amount: 500,
        locationId: 'loc-1',
        note: '下午到店',
      });

      expect(result.status).toBe('PENDING');
      expect(result.locationId).toBe('loc-1');
      expect(mockDb.riderDeposit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ channel: 'OFFLINE_COD', locationId: 'loc-1', note: '下午到店' }),
      });
    });

    it('amount < 100 → E-DEPOSIT-001（service 层兜底，防绕过 zod）', async () => {
      await expect(
        service.createRequest({ riderUserId: 'user-1', channel: 'ONLINE_MOCK', amount: 99 }),
      ).rejects.toThrow(/must be >= 100/);
    });

    it('骑手资料不存在 → E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);
      await expect(
        service.createRequest({ riderUserId: 'user-x', channel: 'ONLINE_MOCK', amount: 500 }),
      ).rejects.toThrow(/not found/);
    });
  });

  describe('payMock 状态机', () => {
    it('PENDING → CONFIRMED：事务内累加 depositAmount', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValueOnce(buildProfile()); // 入口校验
      mockDb.riderDeposit.findUnique.mockResolvedValueOnce(buildDeposit()); // PENDING
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue(buildDeposit({ status: 'CONFIRMED', confirmedAmount: 500, paidAt: new Date(), confirmedAt: new Date() })),
        },
        riderProfile: {
          update: vi.fn().mockResolvedValue(buildProfile({ depositAmount: 500 })),
        },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));
      mockDb.riderProfile.findUniqueOrThrow.mockResolvedValue({ depositAmount: 500 }); // 事务后读余额

      const result = await service.payMock('user-1', 'dep-1');

      expect(result.deposit.status).toBe('CONFIRMED');
      expect(result.deposit.confirmedAmount).toBe(500);
      expect(result.depositAmount).toBe(500);
      // 累加用 increment（DB 原子操作）
      expect(tx.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { depositAmount: { increment: 500 } },
      });
    });

    it('幂等：已 CONFIRMED → 直接返回不重复累加（不进事务）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(
        buildProfile({ depositAmount: 500 }),
      );
      mockDb.riderDeposit.findUnique.mockResolvedValue(
        buildDeposit({ status: 'CONFIRMED', confirmedAmount: 500 }),
      );

      const result = await service.payMock('user-1', 'dep-1');

      expect(result.deposit.status).toBe('CONFIRMED');
      expect(result.depositAmount).toBe(500);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it('并发兜底：事务内 updateMany 命中 0 行（已被并发确认）→ 读最新返回不累加', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValueOnce(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValueOnce(buildDeposit());
      const latest = buildDeposit({ status: 'CONFIRMED', confirmedAmount: 500 });
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 并发已确认
          findUniqueOrThrow: vi.fn().mockResolvedValue(latest),
        },
        riderProfile: { update: vi.fn() },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));
      mockDb.riderProfile.findUniqueOrThrow.mockResolvedValue({ depositAmount: 500 });

      const result = await service.payMock('user-1', 'dep-1');

      expect(result.deposit.status).toBe('CONFIRMED');
      expect(tx.riderProfile.update).not.toHaveBeenCalled(); // 未重复累加
    });

    it('并发兜底分流（P2-2）：0 行命中 + latest=REJECTED → E-DEPOSIT-004 不当成功返回', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValueOnce(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValueOnce(buildDeposit());
      const tx = {
        riderDeposit: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 0 行：事务期间被 admin reject
          findUniqueOrThrow: vi.fn().mockResolvedValue(
            buildDeposit({ status: 'REJECTED', adminNote: 'amount mismatch' }),
          ),
        },
        riderProfile: { update: vi.fn() },
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(tx));

      await expect(service.payMock('user-1', 'dep-1')).rejects.toThrow(
        /Illegal transition: cannot pay-mock a REJECTED/,
      );
      expect(tx.riderProfile.update).not.toHaveBeenCalled(); // 未累加
    });

    it('REJECTED → E-DEPOSIT-004 非法流转', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ status: 'REJECTED' }));

      await expect(service.payMock('user-1', 'dep-1')).rejects.toThrow(/Illegal transition/);
    });

    it('REFUNDED → E-DEPOSIT-004 非法流转', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ status: 'REFUNDED' }));

      await expect(service.payMock('user-1', 'dep-1')).rejects.toThrow(/Illegal transition/);
    });

    it('非 ONLINE_MOCK（OFFLINE_COD）→ E-DEPOSIT-003', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ channel: 'OFFLINE_COD' }));

      await expect(service.payMock('user-1', 'dep-1')).rejects.toThrow(/only for ONLINE_MOCK/);
    });

    it('非本人申请 → E-DEPOSIT-005', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ id: 'rider-2' }));
      mockDb.riderDeposit.findUnique.mockResolvedValue(buildDeposit({ riderId: 'rider-1' }));

      await expect(service.payMock('user-1', 'dep-1')).rejects.toThrow(/Not your deposit/);
    });

    it('申请不存在 → E-DEPOSIT-006', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile());
      mockDb.riderDeposit.findUnique.mockResolvedValue(null);

      await expect(service.payMock('user-1', 'dep-x')).rejects.toThrow(/not found/);
    });
  });

  describe('getStatus 档位派生', () => {
    it('命中档位：查 enabled + minAmount ≤ depositAmount 的最高档', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ depositAmount: 2000 }));
      const tier = {
        id: 'tier-3',
        minAmount: 1000,
        maxOrderAmount: 10000,
        sortOrder: 3,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.riderDepositTier.findFirst.mockResolvedValue(tier);
      mockDb.riderDeposit.findMany.mockResolvedValue([buildDeposit()]);

      const status = await service.getStatus('user-1');

      expect(status.depositAmount).toBe(2000);
      expect(status.tier?.minAmount).toBe(1000);
      expect(status.tier?.maxOrderAmount).toBe(10000);
      expect(mockDb.riderDepositTier.findFirst).toHaveBeenCalledWith({
        where: { enabled: true, minAmount: { lte: 2000 } },
        orderBy: { minAmount: 'desc' },
      });
      expect(status.recentRequests).toHaveLength(1);
    });

    it('未缴（0）或低于最低档 → tier=null（查询仍执行，返回 null）', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ depositAmount: 0 }));
      mockDb.riderDepositTier.findFirst.mockResolvedValue(null);
      mockDb.riderDeposit.findMany.mockResolvedValue([]);

      const status = await service.getStatus('user-1');

      expect(status.depositAmount).toBe(0);
      expect(status.tier).toBeNull();
      expect(status.recentRequests).toEqual([]);
    });

    it('maxOrderAmount=null 档（不限）正常返回', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(buildProfile({ depositAmount: 5000 }));
      mockDb.riderDepositTier.findFirst.mockResolvedValue({
        id: 'tier-top',
        minAmount: 5000,
        maxOrderAmount: null,
        sortOrder: 4,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockDb.riderDeposit.findMany.mockResolvedValue([]);

      const status = await service.getStatus('user-1');
      expect(status.tier?.maxOrderAmount).toBeNull();
    });
  });

  describe('补端点批（2026-09-03）：骑手端只读两端点', () => {
    it('listEnabledLocations：只返回 enabled=true 且字段收窄（id/name/address/note）', async () => {
      mockDb.depositLocation.findMany.mockResolvedValue([
        { id: 'loc-1', name: 'Dili Office', address: 'Dili', note: 'main' },
        { id: 'loc-2', name: 'Baucau Office', address: 'Baucau', note: null },
      ]);
      const items = await service.listEnabledLocations();
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ id: 'loc-1', name: 'Dili Office', address: 'Dili', note: 'main' });
      // where 断言 enabled 过滤（停用点不下发骑手端）
      expect(mockDb.depositLocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true } }),
      );
    });

    it('listEnabledLocations：空列表正常返回 []', async () => {
      mockDb.depositLocation.findMany.mockResolvedValue([]);
      const items = await service.listEnabledLocations();
      expect(items).toEqual([]);
    });

    it('listEnabledTiers：enabled 过滤 + sortOrder 升序（与资格派生同口径）', async () => {
      mockDb.riderDepositTier.findMany.mockResolvedValue([
        { id: 't1', minAmount: 100, maxOrderAmount: 1000, sortOrder: 1, enabled: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 't2', minAmount: 500, maxOrderAmount: 5000, sortOrder: 2, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const tiers = await service.listEnabledTiers();
      expect(tiers).toHaveLength(2);
      expect(tiers[0]?.minAmount).toBe(100);
      expect(mockDb.riderDepositTier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { enabled: true }, orderBy: { sortOrder: 'asc' } }),
      );
    });

    it('listEnabledTiers：结构字段齐（minAmount/maxOrderAmount/sortOrder/enabled）', async () => {
      mockDb.riderDepositTier.findMany.mockResolvedValue([
        { id: 't-top', minAmount: 5000, maxOrderAmount: null, sortOrder: 4, enabled: true, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const [top] = await service.listEnabledTiers();
      expect(top).toMatchObject({ minAmount: 5000, maxOrderAmount: null, sortOrder: 4, enabled: true });
    });
  });
});
