/**
 * Inventory Service 测试（W 流程 2026-06-24）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  stockFindUnique: vi.fn(),
  stockFindMany: vi.fn(),
  stockCreate: vi.fn(),
  stockLogFindMany: vi.fn(),
  stockLogCreate: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  transaction: vi.fn(),
  findWarehouseByPoint: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    stock: {
      findUnique: m.stockFindUnique,
      findMany: m.stockFindMany,
      create: m.stockCreate,
    },
    stockLog: { findMany: m.stockLogFindMany, create: m.stockLogCreate },
    $queryRaw: m.queryRaw,
    $executeRaw: m.executeRaw,
    $transaction: m.transaction,
  },
  withTransaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => {
    // 简化 mock：直接执行 fn 传 mock tx
    return m.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        stock: {
          findUnique: m.stockFindUnique,
          create: m.stockCreate,
        },
        stockLog: { create: m.stockLogCreate },
        $queryRaw: m.queryRaw,
        $executeRaw: m.executeRaw,
      }),
    )();
  }),
  deductStock: vi.fn(),
  releaseStock: vi.fn(),
}));

vi.mock('../src/shared/db/postgis-helpers', () => ({
  findWarehouseByPoint: m.findWarehouseByPoint,
}));

import { InventoryService } from '../src/modules/inventory/inventory.service';

describe('InventoryService', () => {
  let service: InventoryService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new InventoryService();
  });

  describe('matchWarehouse', () => {
    it('PostGIS 匹配到仓库', async () => {
      m.findWarehouseByPoint.mockResolvedValueOnce({
        id: 'wh-1',
        code: 'W01',
        name: { en: 'Dili' },
        deliveryFee: 500,
        distance: 2.5,
      });
      const result = await service.matchWarehouse(-8.5568, 125.56);
      expect(result?.warehouseId).toBe('wh-1');
      expect(result?.deliveryFee).toBe(500);
      expect(result?.distance).toBe(2.5);
    });

    it('超出配送范围返回 null', async () => {
      m.findWarehouseByPoint.mockResolvedValueOnce(null);
      const result = await service.matchWarehouse(0, 0);
      expect(result).toBeNull();
    });
  });

  describe('getStockByAddress', () => {
    it('匹配到仓库 + 该 SKU 有库存', async () => {
      m.findWarehouseByPoint.mockResolvedValueOnce({
        id: 'wh-1',
        code: 'W01',
        name: { en: 'Dili' },
        deliveryFee: 500,
        distance: 1,
      });
      m.stockFindUnique.mockResolvedValueOnce({ quantity: 10 });

      const result = await service.getStockByAddress('sku-1', -8.5568, 125.56);
      expect(result.outOfRange).toBe(false);
      expect(result.inStock).toBe(true);
      expect(result.quantity).toBe(10);
    });

    it('超出范围返 outOfRange=true', async () => {
      m.findWarehouseByPoint.mockResolvedValueOnce(null);
      const result = await service.getStockByAddress('sku-1', 0, 0);
      expect(result.outOfRange).toBe(true);
      expect(result.inStock).toBe(false);
    });

    it('匹配到仓库但 SKU 在该仓没记录返 quantity=0', async () => {
      m.findWarehouseByPoint.mockResolvedValueOnce({
        id: 'wh-1',
        code: 'W01',
        name: { en: 'Dili' },
        deliveryFee: 500,
        distance: 1,
      });
      m.stockFindUnique.mockResolvedValueOnce(null);
      const result = await service.getStockByAddress('sku-1', -8.5568, 125.56);
      expect(result.inStock).toBe(false);
      expect(result.quantity).toBe(0);
    });
  });

  describe('listStocks', () => {
    it('按 warehouseId 过滤', async () => {
      m.stockFindMany.mockResolvedValueOnce([
        {
          id: 'stk-1',
          warehouseId: 'wh-1',
          skuId: 'sku-1',
          quantity: 50,
          safetyStock: 0,
          updatedAt: new Date(),
        },
      ]);
      await service.listStocks({ warehouseId: 'wh-1' });
      expect(m.stockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { warehouseId: 'wh-1' },
        }),
      );
    });

    it('lowStockOnly 过滤 quantity<10', async () => {
      m.stockFindMany.mockResolvedValueOnce([]);
      await service.listStocks({ lowStockOnly: true });
      expect(m.stockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { quantity: { lt: 10 } },
        }),
      );
    });
  });

  describe('adjustStock', () => {
    it('deltaQty=0 抛错（参数校验）', async () => {
      await expect(
        service.adjustStock({
          warehouseId: 'wh-1',
          skuId: 'sku-1',
          deltaQty: 0,
        }),
      ).rejects.toThrow('STOCK_QTY_INVALID');
    });
  });
});
