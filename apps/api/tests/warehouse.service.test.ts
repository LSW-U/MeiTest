/**
 * Warehouse Service 测试（W 流程 2026-06-24；批 B 扩展 2026-09-04）
 *
 * 批 B 新增覆盖：配送费三字段透出（perKmFee/freeKm）、stockSummary 聚合（空仓 0/0/0）、
 * staffList（{id,userId,name,roles}）、operatingHours 契约 Zod safeParse（绕开 controller pipe 盲区）
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
  warehouseStaffFindMany: vi.fn(),
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
    warehouseStaff: { findMany: mocks.warehouseStaffFindMany },
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

import {
  WarehouseService,
  buildStockSummaryMap,
  toStaffList,
} from '../src/modules/warehouse/warehouse.service';
import { WarehouseController } from '../src/modules/warehouse/warehouse.controller';
import { UpsertWarehouseRequest, UpdateWarehouseRequest } from '@meimart/api-contract';
import { BadRequestException } from '@nestjs/common';

/** 仓库行样例（批 B 上提至模块级供各 describe 复用；freeKm 为 Decimal-like，走 decimalToNumber） */
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
  perKmFee: 0,
  freeKm: { toNumber: () => 2 },
  status: 'ACTIVE',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
};

describe('WarehouseService', () => {
  let service: WarehouseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WarehouseService();
  });

  describe('listWarehouses', () => {
    it('返回仓库列表（批 B：库存聚合无行时 stockSummary = 0/0/0）', async () => {
      mocks.warehouseFindMany.mockResolvedValueOnce([mockRow]);
      mocks.queryRaw.mockResolvedValueOnce([]); // stocks 聚合无行
      const list = await service.listWarehouses();
      expect(list).toHaveLength(1);
      expect(list[0].code).toBe('W01');
      expect(list[0].centerLat).toBe(-8.5568);
      expect(list[0].stockSummary).toEqual({ skuCount: 0, totalQuantity: 0, sellableQuantity: 0 });
    });
  });

  describe('getWarehouse', () => {
    it('详情含 coverageArea GeoJSON', async () => {
      mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
      mocks.queryRaw.mockResolvedValueOnce([{ geojson: '{"type":"Polygon","coordinates":[]}' }]);
      mocks.warehouseStaffFindMany.mockResolvedValueOnce([]);
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

// ============================================================================
// 批 B 新增（Warehouse 模块完善 2026-09-04）
// ============================================================================

const VALID_UPSERT = {
  name: { en: 'Dili Warehouse', zh: '帝力仓库', id: 'Gudang Dili', pt: 'Armazém Dili' },
  coverageArea: null,
  centerLat: -8.5568,
  centerLng: 125.56,
  address: 'Rua dos Martires da Patria, Dili',
  operatingHours: null,
  deliveryFee: 500,
  isActive: true,
};

const FULL_HOURS = {
  mon: { open: '08:00', close: '22:00' },
  tue: { open: '08:00', close: '22:00' },
  wed: { open: '08:00', close: '22:00' },
  thu: { open: '08:00', close: '22:00' },
  fri: { open: '08:00', close: '22:00' },
  sat: { open: '08:00', close: '22:00' },
  sun: { open: '08:00', close: '22:00' },
};

describe('WarehouseService · 配送费三字段（批 B）', () => {
  let service: WarehouseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WarehouseService();
  });

  it('createWarehouse 透传 perKmFee/freeKm 到 db.create', async () => {
    mocks.warehouseFindUnique.mockResolvedValueOnce(null); // code 唯一
    mocks.warehouseCreate.mockResolvedValueOnce({ ...mockRow, perKmFee: 50, freeKm: { toNumber: () => 3 } });

    await service.createWarehouse({
      code: 'W01',
      name: VALID_UPSERT.name,
      shopId: 'shop-1',
      address: VALID_UPSERT.address,
      centerLat: -8.5568,
      centerLng: 125.56,
      deliveryFee: 500,
      perKmFee: 50,
      freeKm: 3,
    });

    expect(mocks.warehouseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ perKmFee: 50, freeKm: 3 }) }),
    );
  });

  it('createWarehouse 缺省 perKmFee=0 / freeKm=2（与 schema 默认一致）', async () => {
    mocks.warehouseFindUnique.mockResolvedValueOnce(null);
    mocks.warehouseCreate.mockResolvedValueOnce(mockRow);

    await service.createWarehouse({
      code: 'W02',
      name: VALID_UPSERT.name,
      shopId: 'shop-1',
      address: 'x',
      centerLat: 1,
      centerLng: 2,
      deliveryFee: 600,
    });

    expect(mocks.warehouseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ perKmFee: 0, freeKm: 2 }) }),
    );
  });

  it('updateWarehouse 传 perKmFee/freeKm 时写入，未传时不动', async () => {
    mocks.warehouseFindUnique.mockResolvedValue(mockRow);
    mocks.warehouseUpdate.mockResolvedValue(mockRow);

    await service.updateWarehouse('wh-1', { perKmFee: 80, freeKm: 5 });
    expect(mocks.warehouseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ perKmFee: 80, freeKm: 5 }) }),
    );

    await service.updateWarehouse('wh-1', { address: 'new address' });
    const arg = mocks.warehouseUpdate.mock.calls.at(-1)[0];
    expect(arg.data).not.toHaveProperty('perKmFee');
    expect(arg.data).not.toHaveProperty('freeKm');
  });

  it('listWarehouses / getWarehouse 返回 perKmFee（int）与 freeKm（Decimal → number）', async () => {
    const row = { ...mockRow, perKmFee: 50, freeKm: { toNumber: () => 2.5 } };
    mocks.warehouseFindMany.mockResolvedValueOnce([row]);
    mocks.queryRaw.mockResolvedValueOnce([]);

    const list = await service.listWarehouses();
    expect(list[0].perKmFee).toBe(50);
    expect(list[0].freeKm).toBe(2.5);

    mocks.warehouseFindUnique.mockResolvedValueOnce(row);
    mocks.warehouseStaffFindMany.mockResolvedValueOnce([]);
    mocks.queryRaw.mockResolvedValueOnce([{ geojson: null }]);
    const detail = await service.getWarehouse('wh-1');
    expect(detail.perKmFee).toBe(50);
    expect(detail.freeKm).toBe(2.5);
  });
});

describe('WarehouseService · stockSummary（批 B）', () => {
  let service: WarehouseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WarehouseService();
  });

  it('listWarehouses 聚合正确：skuCount / totalQuantity（含 0）/ sellableQuantity（仅 >0）', async () => {
    mocks.warehouseFindMany.mockResolvedValueOnce([
      mockRow,
      { ...mockRow, id: 'wh-2', code: 'W02' },
    ]);
    // raw SQL 一次聚合（sellable 用 FILTER WHERE quantity>0）：wh-1 两个 SKU（qty 10+0），wh-2 一个（qty 7）
    mocks.queryRaw.mockResolvedValueOnce([
      { warehouse_id: 'wh-1', sku_count: 2, total: 10, sellable: 10 },
      { warehouse_id: 'wh-2', sku_count: 1, total: 7, sellable: 7 },
    ]);

    const list = await service.listWarehouses();
    expect(list[0].stockSummary).toEqual({ skuCount: 2, totalQuantity: 10, sellableQuantity: 10 });
    expect(list[1].stockSummary).toEqual({ skuCount: 1, totalQuantity: 7, sellableQuantity: 7 });
  });

  it('buildStockSummaryMap：映射 + 缺行查不到（调用方兜底 0/0/0）', () => {
    const map = buildStockSummaryMap([{ warehouse_id: 'wh-1', sku_count: 3, total: 12, sellable: 9 }]);
    expect(map.get('wh-1')).toEqual({ skuCount: 3, totalQuantity: 12, sellableQuantity: 9 });
    expect(map.get('missing')).toBeUndefined();
  });
});

describe('WarehouseService · staffList（批 B）', () => {
  let service: WarehouseService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new WarehouseService();
  });

  it('getWarehouse 返回 staffList：{ id, userId, name, roles: [role] }', async () => {
    mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
    mocks.queryRaw.mockResolvedValueOnce([{ geojson: null }]);
    mocks.warehouseStaffFindMany.mockResolvedValueOnce([
      { id: 'ws-1', userId: 'u-1', user: { name: 'Alice', role: 'WAREHOUSE_STAFF' } },
      { id: 'ws-2', userId: 'u-2', user: { name: null, role: 'SUPER_ADMIN' } },
    ]);

    const detail = await service.getWarehouse('wh-1');
    expect(mocks.warehouseStaffFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { warehouseId: 'wh-1' } }),
    );
    expect(detail.staffList).toEqual([
      { id: 'ws-1', userId: 'u-1', name: 'Alice', roles: ['WAREHOUSE_STAFF'] },
      { id: 'ws-2', userId: 'u-2', name: null, roles: ['SUPER_ADMIN'] },
    ]);
  });

  it('无 staff 时 staffList = []', async () => {
    mocks.warehouseFindUnique.mockResolvedValueOnce(mockRow);
    mocks.queryRaw.mockResolvedValueOnce([{ geojson: null }]);
    mocks.warehouseStaffFindMany.mockResolvedValueOnce([]);

    const detail = await service.getWarehouse('wh-1');
    expect(detail.staffList).toEqual([]);
  });

  it('toStaffList 纯函数映射', () => {
    expect(toStaffList([{ id: 'ws-1', userId: 'u-1', user: { name: 'Bob', role: 'RIDER' } }])).toEqual([
      { id: 'ws-1', userId: 'u-1', name: 'Bob', roles: ['RIDER'] },
    ]);
  });
});

describe('operatingHours Zod（契约 UpsertWarehouseRequest safeParse，批 B）', () => {
  it('合法结构通过（全 7 天 08:00–22:00）', () => {
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: FULL_HOURS }).success).toBe(true);
  });

  it('休息日（rest:true 或 open/close 空）通过，即使 close<=open', () => {
    const restDay = { ...FULL_HOURS, sun: { open: '22:00', close: '08:00', rest: true } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: restDay }).success).toBe(true);

    const emptyDay = { ...FULL_HOURS, sun: { open: '', close: '' } }; // 空 = 休息日
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: emptyDay }).success).toBe(true);
  });

  it('缺日拒绝（zod v3 record 枚举键不强制齐全，由 refine 兜住）', () => {
    const { sun: _omit, ...sixDays } = FULL_HOURS;
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: sixDays }).success).toBe(false);
  });

  it('时间格式错拒绝（非 HH:mm）', () => {
    const hours = { ...FULL_HOURS, mon: { open: '8:00', close: '22:00' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: hours }).success).toBe(false);
  });

  it('rest 非布尔拒绝', () => {
    const hours = { ...FULL_HOURS, sun: { open: '', close: '', rest: 'yes' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: hours }).success).toBe(false);
  });

  it('非休息日 close<=open 拒绝（不支持跨天）', () => {
    const eq = { ...FULL_HOURS, sun: { open: '08:00', close: '08:00' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: eq }).success).toBe(false);
    const cross = { ...FULL_HOURS, sun: { open: '22:00', close: '08:00' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: cross }).success).toBe(false);
  });

  it('半空日拒绝（一空一非空，批 B 审查 P3-1：避免未设置但 rest=false 的矛盾态）', () => {
    const halfClose = { ...FULL_HOURS, sun: { open: '', close: '22:00' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: halfClose }).success).toBe(false);
    const halfOpen = { ...FULL_HOURS, sun: { open: '08:00', close: '' } };
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, operatingHours: halfOpen }).success).toBe(false);
  });

  it('perKmFee/freeKm 可选字段：合法值通过；负数 / 超 999km / Infinity 拒绝（P3-2）', () => {
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, perKmFee: 50, freeKm: 2 }).success).toBe(true);
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, perKmFee: 50, freeKm: 999 }).success).toBe(true);
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, freeKm: -1 }).success).toBe(false);
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, freeKm: 1000 }).success).toBe(false);
    expect(UpsertWarehouseRequest.safeParse({ ...VALID_UPSERT, freeKm: 1e999 }).success).toBe(false);
  });
});

describe('UpdateWarehouseRequest（批 B 审查 P2-1，用户拍板选 a）', () => {
  it('部分更新通过：{isActive} / {name,address,isActive}（admin-web toggleActive/saveBasic 场景）', () => {
    expect(UpdateWarehouseRequest.safeParse({ isActive: true }).success).toBe(true);
    expect(UpdateWarehouseRequest.safeParse({ name: { en: 'x' }, address: 'x', isActive: true }).success).toBe(true);
  });

  it('create 仍为全必填：部分 body 在 UpsertWarehouseRequest 下拒绝', () => {
    expect(UpsertWarehouseRequest.safeParse({ isActive: true }).success).toBe(false);
    expect(UpsertWarehouseRequest.safeParse({ name: { en: 'x' }, address: 'x', isActive: true }).success).toBe(false);
  });

  it('update 传 operatingHours 时仍走同源语义校验（缺日/跨天/半空日拒绝）', () => {
    const ok = UpdateWarehouseRequest.safeParse({ operatingHours: FULL_HOURS });
    expect(ok.success).toBe(true);

    const { sun: _omit, ...sixDays } = FULL_HOURS;
    expect(UpdateWarehouseRequest.safeParse({ operatingHours: sixDays }).success).toBe(false);

    const cross = { ...FULL_HOURS, sun: { open: '22:00', close: '08:00' } };
    expect(UpdateWarehouseRequest.safeParse({ operatingHours: cross }).success).toBe(false);

    const half = { ...FULL_HOURS, sun: { open: '08:00', close: '' } };
    expect(UpdateWarehouseRequest.safeParse({ operatingHours: half }).success).toBe(false);
  });

  it('freeKm 上限同步生效（999 通过 / 1e999 拒绝）', () => {
    expect(UpdateWarehouseRequest.safeParse({ freeKm: 999 }).success).toBe(true);
    expect(UpdateWarehouseRequest.safeParse({ freeKm: 1e999 }).success).toBe(false);
  });

  it('controller 双管道：UPDATE_PIPE 放行部分更新，UPSERT_PIPE 拒绝（pipe 实例直测）', () => {
    expect(() => WarehouseController.UPDATE_PIPE.transform({ isActive: true }, {} as never)).not.toThrow();
    expect(() => WarehouseController.UPSERT_PIPE.transform({ isActive: true }, {} as never)).toThrow(BadRequestException);
    try {
      WarehouseController.UPSERT_PIPE.transform({ isActive: true }, {} as never);
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({ code: 'E-WAREHOUSE-004' });
    }
  });
});
