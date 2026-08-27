/**
 * Pricing Service 测试（W 流程 2026-06-24；距离计费改造 2026-08-27 批次1）
 *
 * 覆盖（《02-配送费计算公式.md》Q1-Q11 + 实施方案 §4.5）：
 *   - 距离 0（地址=仓库中心）→ fee = baseFee（max(0, -2)=0）
 *   - 短单 1km → fee = baseFee（仍在 freeKm 内）
 *   - 标准 3km → fee = baseFee + 1×perKmFee
 *   - 远单 10km → fee = baseFee + 8×perKmFee
 *   - per_km_fee = 0 → 公式退化 = baseFee（与现状一致，灰度安全网）
 *   - 取整 → Math.round 到分
 *   - freeKm 用 warehouse.freeKm（非默认 2）
 *   - 无 centerPoint（$queryRaw 返回空 / km=null）→ distanceKm=null，fee 退化为 baseFee 不抛错
 *   - 仓库不存在抛 NotFoundException
 *
 * Mock：db.warehouse.findUnique + db.$queryRaw（PostGIS raw SQL 不在单测覆盖，
 *      完整 PostGIS 集成 W6 用 testcontainers 补，与 warehouse.service.test.ts 同约定）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  warehouseFindUnique: vi.fn(),
  warehouseFindMany: vi.fn(),
  warehouseUpdate: vi.fn(),
  queryRaw: vi.fn(),
  distanceSphereKm: vi.fn(),
  isPointInWarehouseCoverage: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    warehouse: {
      findUnique: m.warehouseFindUnique,
      findMany: m.warehouseFindMany,
      update: m.warehouseUpdate,
    },
    $queryRaw: m.queryRaw,
  },
}));

// P3-1 修复：distanceSphereKm / isPointInWarehouseCoverage 已迁到 postgis-helpers.ts
// calcDeliveryFee 直接 import 调用，须单独 mock（不经过 db.$queryRaw）
vi.mock('../src/shared/db/postgis-helpers', () => ({
  distanceSphereKm: m.distanceSphereKm,
  isPointInWarehouseCoverage: m.isPointInWarehouseCoverage,
}));

import { PricingService } from '../src/modules/pricing/pricing.service';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new PricingService();
  });

  /**
   * 构造 warehouse mock。
   * perKmFee/freeKm/deliveryFee 可覆盖；centerLat/Lng 仅 listWarehousePricingConfig 用。
   */
  const mockWarehouse = (overrides: Partial<{
    deliveryFee: number;
    perKmFee: number;
    freeKm: { toNumber: () => number } | null;
  }> = {}) => ({
    id: 'wh-1',
    code: 'W01',
    name: { en: 'Dili' },
    deliveryFee: overrides.deliveryFee ?? 500,
    perKmFee: overrides.perKmFee ?? 50,
    freeKm: overrides.freeKm ?? { toNumber: () => 2 },
    centerLat: { toNumber: () => -8.5568 },
    centerLng: { toNumber: () => 125.56 },
    status: 'ACTIVE',
  });

  /**
   * mock PostGIS helpers：coverage 守卫 + 球面距离。
   * P3-1 修复（2026-08-27 审查报告）：distanceSphereKm/isPointInWarehouseCoverage 已迁到
   *   postgis-helpers.ts，calcDeliveryFee 直接 import 调用，按方法 mock（不经 db.$queryRaw）。
   *
   * @param km 计费距离；null = centerPoint 缺失（distanceSphereKm 返回 null）
   * @param inCoverage coverage 守卫结果，默认 true（在覆盖区内）
   */
  const mockPostgis = (km: number | null, inCoverage: boolean = true) => {
    m.isPointInWarehouseCoverage.mockResolvedValueOnce(inCoverage);
    m.distanceSphereKm.mockResolvedValueOnce(km);
  };

  describe('calcDeliveryFee - 距离计费公式', () => {
    it('距离 0（地址=仓库中心）→ fee = baseFee（max(0, -2)=0）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(0);
      const r = await service.calcDeliveryFee('wh-1', -8.5568, 125.56);
      expect(r.baseFee).toBe(500);
      expect(r.distanceKm).toBe(0);
      expect(r.distanceFee).toBe(0);
      expect(r.deliveryFee).toBe(500);
      expect(r.perKmFee).toBe(50);
      expect(r.freeKm).toBe(2);
      expect(r.currency).toBe('USD');
    });

    it('短单 1km → fee = baseFee（仍在 freeKm=2 内）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(1);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceKm).toBe(1);
      expect(r.distanceFee).toBe(0); // max(0, 1-2)=0
      expect(r.deliveryFee).toBe(500);
    });

    it('标准 3km → fee = baseFee + 1×perKmFee = 550', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(3);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceFee).toBe(50); // max(0, 3-2)=1 × 50
      expect(r.deliveryFee).toBe(550);
    });

    it('远单 10km → fee = baseFee + 8×perKmFee = 900', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(10);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceFee).toBe(400); // max(0, 10-2)=8 × 50
      expect(r.deliveryFee).toBe(900);
    });

    it('per_km_fee = 0 → 公式退化 = baseFee（与现状一致，灰度安全网）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse({ perKmFee: 0 }));
      mockPostgis(10);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceFee).toBe(0); // 8 × 0
      expect(r.deliveryFee).toBe(500); // 退化为 baseFee
    });

    it('取整 → Math.round 到分（distanceKm=2.45, perKmFee=50 → 0.45×50=22.5 → round 23）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      // chargeableKm = 2.45 - 2 = 0.45; 0.45 × 50 = 22.5 → Math.round = 23（非 22）
      mockPostgis(2.45);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceFee).toBe(23);
      expect(r.deliveryFee).toBe(523);
    });

    it('freeKm 用 warehouse.freeKm（=5）→ 3km 仍在免费距离内', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse({ freeKm: { toNumber: () => 5 } }));
      mockPostgis(3);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.freeKm).toBe(5);
      expect(r.distanceFee).toBe(0); // max(0, 3-5)=0
      expect(r.deliveryFee).toBe(500);
    });

    it('无 centerPoint（$queryRaw 返回空行）→ distanceKm=null，fee 退化为 baseFee 不抛错', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(null); // coverage=true + distanceSphereKm 返回空行
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceKm).toBeNull();
      expect(r.distanceFee).toBe(0);
      expect(r.deliveryFee).toBe(500); // 退化为 baseFee，不阻断
    });

    it('PostGIS 返回 km=null → distanceKm=null，fee 退化为 baseFee', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      // coverage=true；distanceSphereKm 返回 null（centerPoint 缺失）
      m.isPointInWarehouseCoverage.mockResolvedValueOnce(true);
      m.distanceSphereKm.mockResolvedValueOnce(null);
      const r = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(r.distanceKm).toBeNull();
      expect(r.deliveryFee).toBe(500);
    });

    it('仓库不存在抛 NotFoundException', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.calcDeliveryFee('missing', 0, 0)).rejects.toThrow(NotFoundException);
    });

    it('P3-1：地址不在仓库覆盖区 → 抛 NotFoundException（coverage 守卫）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      mockPostgis(3, false); // coverage=false
      await expect(service.calcDeliveryFee('wh-1', -8.5, 125.5)).rejects.toThrow(NotFoundException);
    });
  });

  // P2-3 修复（2026-08-27 审查报告）：checkMinOrder 死代码已删，对应测试一并移除
  //   起送价需求激活时（读 warehouse.minOrderAmount + createOrder 接入）再补测试

  describe('listWarehousePricingConfig', () => {
    it('返回所有仓库的配送费配置（含 perKmFee/freeKm）', async () => {
      m.warehouseFindMany.mockResolvedValueOnce([mockWarehouse()]);
      const r = await service.listWarehousePricingConfig();
      expect(r).toHaveLength(1);
      expect(r[0].code).toBe('W01');
      expect(r[0].baseFee).toBe(500);
      expect(r[0].perKmFee).toBe(50);
      expect(r[0].freeKm).toBe(2);
      expect(r[0].center.lat).toBe(-8.5568);
    });
  });

  describe('updateBaseFee', () => {
    it('更新基础配送费', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse());
      m.warehouseUpdate.mockResolvedValueOnce({ ...mockWarehouse(), deliveryFee: 800 });
      const r = await service.updateBaseFee('wh-1', 800);
      expect(r.baseFee).toBe(800);
      expect(m.warehouseUpdate).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { deliveryFee: 800 },
      });
    });

    it('仓库不存在抛 NotFoundException', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.updateBaseFee('missing', 100)).rejects.toThrow(NotFoundException);
    });
  });
});
