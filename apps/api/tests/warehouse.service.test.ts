/**
 * Warehouse Service 测试（W 流程 2026-06-24）
 *
 * 注意：PostGIS raw SQL 不在单测覆盖（需 testcontainers），这里只测 prisma 调用 + service 编排
 * 完整 PostGIS 集成测试 W6 用 testcontainers 补
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, ConflictException } from '@nestjs/common';

const mocks = vi.hoisted(() => ({
  warehouseFindMany: vi.fn(),
  warehouseFindUnique: vi.fn(),
  warehouseCreate: vi.fn(),
  warehouseUpdate: vi.fn(),
  warehouseDelete: vi.fn(),
  shopFindFirst: vi.fn(),
  setWarehouseGeometry: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    warehouse: {
      findMany: mocks.warehouseFindMany,
      findUnique: mocks.warehouseFindUnique,
      create: mocks.warehouseCreate,
      update: mocks.warehouseUpdate,
      delete: mocks.warehouseDelete,
    },
    shop: { findFirst: mocks.shopFindFirst },
    $queryRaw: mocks.queryRaw,
  },
}));

vi.mock('../src/shared/db/postgis-helpers', () => ({
  setWarehouseGeometry: mocks.setWarehouseGeometry,
  buildBoxPolygon: vi.fn(
    (lon: number, lat: number, r: number) =>
      ({
        type: 'Polygon' as const,
        coordinates: [
          [
            [lon - r, lat - r],
            [lon + r, lat - r],
            [lon + r, lat + r],
            [lon - r, lat + r],
            [lon - r, lat - r],
          ],
        ],
      }) as unknown,
  ),
}));

import { WarehouseService } from '../src/modules/warehouse/warehouse.service';

describe('WarehouseService', () => {
  let service: WarehouseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WarehouseService();
  });

  const mockRow = {
    id: 'wh-1',
    code: 'W01',
    name: { en: 'Dili', zh: '帝力' },
    shopId: 'shop-1',
    address: 'Dili',
    centerLat: { toNumber: () => -8.5568 },
    centerLng: { toNumber: () => 125.56 },
    operatingHours: { mon: { open: '08:00', close: '22:00' } },
    deliveryFee: 500,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  describe('listWarehouses', () => {
    it('返回仓库列表', async () => {
      mocks.warehouseFindMany.mockResolvedValueOnce([mockRow]);
      const list = await service.listWarehouses();
      expect(list).toHaveLength(1);
      expect(list[0].code).toBe('W01');
      expect(list[0].centerLat).toBe(-8.5568);
    });
  });

  describe('getWarehouse', () => {
    it('详情含 coverageArea GeoJSON', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
      mocks.queryRaw.mockResolvedValueOnce([{ geojson: '{"type":"Polygon","coordinates":[]}' }]);
      const w = await service.getWarehouse('wh-1');
      expect(w.id).toBe('wh-1');
      expect(w.coverageArea).toEqual({ type: 'Polygon', coordinates: [] });
    });

    it('找不到抛 NotFoundException', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.getWarehouse('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createWarehouse', () => {
    it('code 重复抛 ConflictException', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce({ id: 'existing' });
      await expect(
        service.createWarehouse({
          code: 'W01',
          name: { en: 'X' },
          shopId: 'shop-1',
          address: 'x',
          centerLat: 0,
          centerLng: 0,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('正常创建：prisma.create + setWarehouseGeometry', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(null);
      mocks.warehouseCreate.mockResolvedValueOnce({ ...mockRow, id: 'wh-new' });
      mocks.setWarehouseGeometry.mockResolvedValueOnce(undefined);

      const result = await service.createWarehouse({
        code: 'W99',
        name: { en: 'New' },
        shopId: 'shop-1',
        address: 'x',
        centerLat: -8.5,
        centerLng: 125.5,
      });
      expect(result.id).toBe('wh-new');
      expect(mocks.warehouseCreate).toHaveBeenCalled();
      expect(mocks.setWarehouseGeometry).toHaveBeenCalled();
    });
  });

  describe('updateWarehouse', () => {
    it('只更普通字段时不调 setWarehouseGeometry', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
      mocks.warehouseUpdate.mockResolvedValueOnce({ ...mockRow, address: 'New Addr' });

      await service.updateWarehouse('wh-1', { address: 'New Addr' });
      expect(mocks.setWarehouseGeometry).not.toHaveBeenCalled();
    });

    it('传 centerLat 时触发 PostGIS 写入', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
      mocks.warehouseUpdate.mockResolvedValueOnce(mockRow);
      mocks.setWarehouseGeometry.mockResolvedValueOnce(undefined);

      await service.updateWarehouse('wh-1', { centerLat: -9 });
      expect(mocks.setWarehouseGeometry).toHaveBeenCalled();
    });

    it('找不到抛 NotFoundException', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.updateWarehouse('missing', { address: 'x' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteWarehouse', () => {
    it('软删除（update status=INACTIVE，不调用 delete）', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
      mocks.warehouseUpdate.mockResolvedValueOnce({ ...mockRow, status: 'INACTIVE' });
      await service.deleteWarehouse('wh-1');
      expect(mocks.warehouseUpdate).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { status: 'INACTIVE' },
      });
      expect(mocks.warehouseDelete).not.toHaveBeenCalled();
    });

    it('找不到抛 NotFoundException', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.deleteWarehouse('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
