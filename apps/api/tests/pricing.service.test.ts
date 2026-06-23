/**
 * Pricing Service 测试（W 流程 2026-06-24）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  warehouseFindUnique: vi.fn(),
  warehouseFindMany: vi.fn(),
  warehouseUpdate: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    warehouse: {
      findUnique: m.warehouseFindUnique,
      findMany: m.warehouseFindMany,
      update: m.warehouseUpdate,
    },
  },
}));

import { PricingService } from '../src/modules/pricing/pricing.service';

describe('PricingService', () => {
  let service: PricingService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new PricingService();
  });

  const mockWarehouse = {
    id: 'wh-1',
    code: 'W01',
    name: { en: 'Dili' },
    deliveryFee: 500,
    centerLat: { toNumber: () => -8.5568 },
    centerLng: { toNumber: () => 125.56 },
    status: 'ACTIVE',
  };

  describe('calcDeliveryFee', () => {
    it('返回基础配送费 + 距离（perKmFee=0 时 deliveryFee=baseFee）', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse);
      // 同地址距离=0
      const result = await service.calcDeliveryFee('wh-1', -8.5568, 125.56);
      expect(result.baseFee).toBe(500);
      expect(result.deliveryFee).toBe(500);
      expect(result.distance).toBe(0);
      expect(result.currency).toBe('USD');
    });

    it('距离不为 0 时 distance 字段反映实际值', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse);
      const result = await service.calcDeliveryFee('wh-1', -8.5, 125.5);
      expect(result.distance).toBeGreaterThan(0);
      expect(result.distance).toBeLessThan(50); // 同城市内通常 < 50km
    });

    it('仓库不存在抛 NotFoundException', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(null);
      await expect(service.calcDeliveryFee('missing', 0, 0)).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkMinOrder', () => {
    it('cartTotal >= minOrderAmount（默认 0）ok=true', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse);
      const result = await service.checkMinOrder('wh-1', 5000);
      expect(result.ok).toBe(true);
      expect(result.shortfall).toBe(0);
    });
  });

  describe('listWarehousePricingConfig', () => {
    it('返回所有仓库的配送费配置', async () => {
      m.warehouseFindMany.mockResolvedValueOnce([mockWarehouse]);
      const result = await service.listWarehousePricingConfig();
      expect(result).toHaveLength(1);
      expect(result[0].code).toBe('W01');
      expect(result[0].baseFee).toBe(500);
      expect(result[0].center.lat).toBe(-8.5568);
    });
  });

  describe('updateBaseFee', () => {
    it('更新基础配送费', async () => {
      m.warehouseFindUnique.mockResolvedValueOnce(mockWarehouse);
      m.warehouseUpdate.mockResolvedValueOnce({ ...mockWarehouse, deliveryFee: 800 });

      const result = await service.updateBaseFee('wh-1', 800);
      expect(result.baseFee).toBe(800);
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
