/**
 * adminListRiders 列表增强单测（批 E 审查 P1-2，2026-09-03）
 *
 * 覆盖：列表响应补 depositAmount / maxOrderAmount（停用档回落口径）/ todayDeliveries /
 *   在线状态沿用既有 isOnline；字段与批 C 聚合详情口径一致。
 *
 * mock：db（riderProfile/riderDepositTier/deliveryTask）+ redis
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    riderProfile: {
      findMany: vi.fn(),
    },
    riderDepositTier: {
      findMany: vi.fn(),
    },
    deliveryTask: {
      groupBy: vi.fn(),
    },
  },
  mockRedis: {
    exists: vi.fn(),
    ttl: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));

import { RiderService } from '../src/modules/rider/rider.service';

function buildProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'r-1',
    userId: 'u-1',
    riderName: 'Alice',
    phone: '+6701',
    vehicleType: 'MOTORCYCLE',
    vehiclePlate: null,
    status: 'OFFLINE',
    applicationStatus: 'APPROVED',
    totalDeliveries: 10,
    rating: { toNumber: () => 4.5 } as unknown as number,
    depositAmount: 1000,
    preferredWarehouseIds: [],
    idCardNumber: null,
    avatarUrl: null,
    points: 0,
    tier: 'BRONZE',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** seed 同构 4 档（desc 序，service 依赖 orderBy minAmount desc） */
const TIERS = [
  { id: 't4', minAmount: 5000, maxOrderAmount: 50000 },
  { id: 't3', minAmount: 1000, maxOrderAmount: 10000 },
  { id: 't2', minAmount: 500, maxOrderAmount: 5000 },
  { id: 't1', minAmount: 100, maxOrderAmount: 1000 },
];

describe('adminListRiders 列表增强（P1-2）', () => {
  let service: RiderService;

  beforeEach(() => {
    service = new RiderService();
    mockDb.riderProfile.findMany.mockReset();
    mockDb.riderDepositTier.findMany.mockReset();
    mockDb.deliveryTask.groupBy.mockReset();
    mockRedis.exists.mockReset();
    mockRedis.ttl.mockReset();
    mockRedis.exists.mockResolvedValue(0); // 默认离线
  });

  it('列表行含 depositAmount / maxOrderAmount / todayDeliveries', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([buildProfile()]);
    mockDb.riderDepositTier.findMany.mockResolvedValue(TIERS);
    mockDb.deliveryTask.groupBy.mockResolvedValue([{ riderId: 'r-1', _count: { _all: 3 } }]);

    const { items } = await service.adminListRiders({});
    expect(items[0].depositAmount).toBe(1000);
    expect(items[0].maxOrderAmount).toBe(10000); // $10 档
    expect(items[0].todayDeliveries).toBe(3);
    expect(items[0].isOnline).toBe(false);
  });

  it('停用档回落：$10 档停用后 deposit 2000 → 上限回落 $5 档（5000）', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([buildProfile({ depositAmount: 2000 })]);
    mockDb.riderDepositTier.findMany.mockResolvedValue(TIERS.filter((t) => t.id !== 't3')); // $10 档停用
    mockDb.deliveryTask.groupBy.mockResolvedValue([]);

    const { items } = await service.adminListRiders({});
    expect(items[0].maxOrderAmount).toBe(5000);
  });

  it('未缴（0）→ maxOrderAmount=0（与派单资格口径一致）', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([buildProfile({ depositAmount: 0 })]);
    mockDb.riderDepositTier.findMany.mockResolvedValue(TIERS);
    mockDb.deliveryTask.groupBy.mockResolvedValue([]);

    const { items } = await service.adminListRiders({});
    expect(items[0].maxOrderAmount).toBe(0);
  });

  it('顶配 null 上限档：maxOrderAmount=null（不限）', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([buildProfile({ depositAmount: 8000 })]);
    mockDb.riderDepositTier.findMany.mockResolvedValue([
      { id: 't-top', minAmount: 5000, maxOrderAmount: null },
    ]);
    mockDb.deliveryTask.groupBy.mockResolvedValue([]);

    const { items } = await service.adminListRiders({});
    expect(items[0].maxOrderAmount).toBeNull();
  });

  it('今日单量 groupBy 只统计 DELIVERED 且 riderId 非空（口径锁定）', async () => {
    mockDb.riderProfile.findMany.mockResolvedValue([buildProfile()]);
    mockDb.riderDepositTier.findMany.mockResolvedValue(TIERS);
    mockDb.deliveryTask.groupBy.mockResolvedValue([]);

    await service.adminListRiders({});
    expect(mockDb.deliveryTask.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'DELIVERED', riderId: { not: null } }),
      }),
    );
  });
});
