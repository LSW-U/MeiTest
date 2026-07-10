/**
 * Admin Rider Service tests (W7-ext-D)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb, mockRedis } = vi.hoisted(() => ({
  mockDb: {
    riderProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockRedis: {
    exists: vi.fn(),
    del: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));
vi.mock('../src/shared/cache', () => ({ redis: mockRedis }));
vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { RiderService } from '../src/modules/rider/rider.service';

describe('RiderService.adminRiders (W7-ext-D)', () => {
  let service: RiderService;

  beforeEach(() => {
    Object.values(mockDb).forEach((table) => Object.values(table).forEach((fn) => fn.mockReset()));
    Object.values(mockRedis).forEach((fn) => fn.mockReset());
    // @ts-expect-error - RiderService constructor signature doesn't matter for these tests
    service = new RiderService();
  });

  const sampleProfile = {
    id: 'rider-1',
    userId: 'user-1',
    riderName: 'John',
    phone: '12345678',
    vehicleType: 'MOTORCYCLE',
    vehiclePlate: 'B123ABC',
    status: 'OFFLINE',
    totalDeliveries: 0,
    rating: { toNumber: () => 5 },
    applicationStatus: 'APPROVED',
    idCardNumber: 'ID123456',
    reviewedById: null,
    reviewedAt: null,
    rejectReason: null,
    preferredWarehouseIds: ['wh-1'],
    createdAt: new Date('2026-06-25T00:00:00.000Z'),
    updatedAt: new Date('2026-06-25T00:00:00.000Z'),
  };

  describe('adminListRiders', () => {
    it('返回 APPROVED 骑手列表', async () => {
      mockDb.riderProfile.findMany.mockResolvedValue([sampleProfile]);

      const result = await service.adminListRiders({ keyword: 'john' });

      expect(mockDb.riderProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          applicationStatus: 'APPROVED',
          OR: expect.arrayContaining([
            { riderName: { contains: 'john' } },
            { phone: { contains: 'john' } },
          ]),
        }),
        take: 50,
      }));
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('rider-1');
    });

    it('warehouseId 过滤 -> preferredWarehouseIds.has', async () => {
      mockDb.riderProfile.findMany.mockResolvedValue([]);

      await service.adminListRiders({ warehouseId: 'wh-1' });

      expect(mockDb.riderProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          preferredWarehouseIds: { has: 'wh-1' },
        }),
      }));
    });

    it('limit 上限 100', async () => {
      mockDb.riderProfile.findMany.mockResolvedValue([]);

      await service.adminListRiders({ limit: 500 });

      expect(mockDb.riderProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
        take: 100,
      }));
    });
  });

  describe('adminGetRiderDetail', () => {
    it('骑手不存在 -> 抛 E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);

      await expect(service.adminGetRiderDetail('rider-x')).rejects.toMatchObject({
        response: { code: 'E-RIDER-001' },
        status: 404,
      });
    });

    it('返回详情含 userStatus + recentOrders', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue({
        ...sampleProfile,
        user: { id: 'user-1', status: 'ACTIVE', phone: '12345678' },
        orders: [
          {
            id: 'order-1',
            orderNo: 'MM20260625010001',
            status: 'PENDING_CONFIRM',
            payableAmount: 1000,
            createdAt: new Date('2026-06-25T10:00:00.000Z'),
          },
        ],
      });
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.adminGetRiderDetail('rider-1');

      expect(result.id).toBe('rider-1');
      expect(result.userStatus).toBe('ACTIVE');
      expect(result.recentOrders).toHaveLength(1);
      expect(result.recentOrders[0].orderNo).toBe('MM20260625010001');
    });
  });

  describe('adminUpdateRider', () => {
    it('骑手不存在 -> 抛 E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.adminUpdateRider('rider-x', { vehicleType: 'CAR' }),
      ).rejects.toMatchObject({ response: { code: 'E-RIDER-001' }, status: 404 });
    });

    it('空 input -> 不调 update，返回当前 profile', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockRedis.exists.mockResolvedValue(0);

      await service.adminUpdateRider('rider-1', {});

      expect(mockDb.riderProfile.update).not.toHaveBeenCalled();
    });

    it('Happy path -> 调 update + 返回', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      const updated = { ...sampleProfile, vehicleType: 'CAR' as const };
      mockDb.riderProfile.update.mockResolvedValue(updated);
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.adminUpdateRider('rider-1', { vehicleType: 'CAR' });

      expect(mockDb.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { vehicleType: 'CAR' },
      });
      expect(result.vehicleType).toBe('CAR');
    });

    it('vehiclePlate=null 清空', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      const updated = { ...sampleProfile, vehiclePlate: null };
      mockDb.riderProfile.update.mockResolvedValue(updated);
      mockRedis.exists.mockResolvedValue(0);

      await service.adminUpdateRider('rider-1', { vehiclePlate: null });

      expect(mockDb.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { vehiclePlate: null },
      });
    });
  });

  describe('adminSuspendRider', () => {
    it('骑手不存在 -> 抛 E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);

      await expect(service.adminSuspendRider('rider-x')).rejects.toMatchObject({
        response: { code: 'E-RIDER-001' },
        status: 404,
      });
    });

    it('已 SUSPENDED -> 抛 E-RIDER-002', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'SUSPENDED' });

      await expect(service.adminSuspendRider('rider-1')).rejects.toMatchObject({
        response: { code: 'E-RIDER-002' },
        status: 409,
      });
    });

    it('Happy path -> user.update + riderProfile.update + redis.del', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });

      const result = await service.adminSuspendRider('rider-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'SUSPENDED' },
      });
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { status: 'OFFLINE' },
      });
      expect(mockRedis.del).toHaveBeenCalled();
      expect(result.userStatus).toBe('SUSPENDED');
    });
  });

  describe('adminActivateRider', () => {
    it('已 ACTIVE -> 抛 E-RIDER-003', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });

      await expect(service.adminActivateRider('rider-1')).rejects.toMatchObject({
        response: { code: 'E-RIDER-003' },
        status: 409,
      });
    });

    it('DELETED -> 抛 E-RIDER-004', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'DELETED' });

      await expect(service.adminActivateRider('rider-1')).rejects.toMatchObject({
        response: { code: 'E-RIDER-004' },
        status: 409,
      });
    });

    it('Happy path', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'SUSPENDED' });

      const result = await service.adminActivateRider('rider-1');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'ACTIVE' },
      });
      expect(result.userStatus).toBe('ACTIVE');
    });
  });

  describe('adminDeleteRider', () => {
    it('骑手不存在 -> 抛 E-RIDER-001', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(null);

      await expect(service.adminDeleteRider('rider-x', 'admin-1')).rejects.toMatchObject({
        response: { code: 'E-RIDER-001' },
        status: 404,
      });
    });

    it('删自己 -> 抛 E-RIDER-005', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue({ ...sampleProfile, userId: 'admin-1' });

      await expect(service.adminDeleteRider('rider-1', 'admin-1')).rejects.toMatchObject({
        response: { code: 'E-RIDER-005' },
        status: 409,
      });
    });

    it('已 DELETED -> 抛 E-RIDER-006', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'DELETED' });

      await expect(service.adminDeleteRider('rider-1', 'admin-2')).rejects.toMatchObject({
        response: { code: 'E-RIDER-006' },
        status: 409,
      });
    });

    it('Happy path', async () => {
      mockDb.riderProfile.findUnique.mockResolvedValue(sampleProfile);
      mockDb.user.findUnique.mockResolvedValue({ id: 'user-1', status: 'ACTIVE' });

      const result = await service.adminDeleteRider('rider-1', 'admin-2');

      expect(mockDb.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { status: 'DELETED' },
      });
      expect(mockDb.riderProfile.update).toHaveBeenCalledWith({
        where: { id: 'rider-1' },
        data: { status: 'OFFLINE' },
      });
      expect(result.userStatus).toBe('DELETED');
    });
  });
});
