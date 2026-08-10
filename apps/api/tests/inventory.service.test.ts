/**
 * Inventory Service 测试（W 流程 2026-06-24）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

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
  deductStock: vi.fn(),
  releaseStock: vi.fn(),
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
  withTransaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    // 简化 mock：直接执行 fn 传 mock tx（fn 抛错即 reject，模拟事务回滚）
    return fn({
      stock: {
        findUnique: m.stockFindUnique,
        create: m.stockCreate,
      },
      stockLog: { create: m.stockLogCreate },
      $queryRaw: m.queryRaw,
      $executeRaw: m.executeRaw,
    });
  }),
  deductStock: m.deductStock,
  releaseStock: m.releaseStock,
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

    it('lowStockOnly 用 safetyStock 字段过滤（修批次 5 bug，原硬编码 10）', async () => {
      m.stockFindMany.mockResolvedValueOnce([
        { warehouseId: 'wh-1', skuId: 'sku-low', quantity: 5, safetyStock: 10, updatedAt: new Date() }, // 5<=10 ✓
        { warehouseId: 'wh-1', skuId: 'sku-ok', quantity: 50, safetyStock: 10, updatedAt: new Date() }, // 50>10 ✗
        { warehouseId: 'wh-1', skuId: 'sku-edge', quantity: 10, safetyStock: 10, updatedAt: new Date() }, // 10<=10 ✓ 边界
      ]);
      const result = await service.listStocks({ lowStockOnly: true });
      // findMany 不带 quantity filter（改用 JS filter safetyStock）
      expect(m.stockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
      expect(result).toHaveLength(2);
      expect(result.map((s) => s.skuId)).toEqual(['sku-low', 'sku-edge']);
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
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('transferStock（批次 5 双仓原子 TDD 核心）', () => {
    it('成功：deductStock 源仓 + 目标仓 update + INBOUND log（同 referenceId 串联）', async () => {
      m.deductStock.mockResolvedValue(true);
      m.stockFindUnique.mockResolvedValue({ warehouseId: 'wh-2', skuId: 'sku-1', quantity: 5 });

      const result = await service.transferStock({
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ skuId: 'sku-1', quantity: 3 }],
        operatorId: 'admin-1',
      });

      expect(m.deductStock).toHaveBeenCalledWith(
        expect.anything(),
        'wh-1',
        'sku-1',
        3,
        expect.objectContaining({
          referenceType: 'TRANSFER',
          referenceId: result.referenceId,
        }),
      );
      expect(m.executeRaw).toHaveBeenCalled();
      expect(m.stockLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh-2',
            changeType: 'INBOUND',
            changeQty: 3,
            referenceType: 'TRANSFER',
            referenceId: result.referenceId,
          }),
        }),
      );
      expect(result.items[0]).toMatchObject({
        skuId: 'sku-1',
        quantity: 3,
        toAfterQty: 8,
      });
    });

    it('目标仓 stock 不存在 → 创建 + INBOUND（A 决策）', async () => {
      m.deductStock.mockResolvedValue(true);
      m.stockFindUnique.mockResolvedValue(null);

      const result = await service.transferStock({
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ skuId: 'sku-new', quantity: 10 }],
      });

      expect(m.stockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { warehouseId: 'wh-2', skuId: 'sku-new', quantity: 10 },
        }),
      );
      expect(m.executeRaw).not.toHaveBeenCalled();
      expect(result.items[0].toAfterQty).toBe(10);
    });

    it('源仓不足 → E-INVENTORY-001（整事务回滚，目标仓无变化）', async () => {
      m.deductStock.mockResolvedValue(false);

      await expect(
        service.transferStock({
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-2',
          items: [{ skuId: 'sku-1', quantity: 100 }],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-INVENTORY-001' } });

      expect(m.executeRaw).not.toHaveBeenCalled();
    });

    it('同仓 → E-INVENTORY-005', async () => {
      await expect(
        service.transferStock({
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-1',
          items: [{ skuId: 'sku-1', quantity: 1 }],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-INVENTORY-005' } });
    });

    it('items 空 → E-INVENTORY-006', async () => {
      await expect(
        service.transferStock({
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-2',
          items: [],
        }),
      ).rejects.toMatchObject({ response: { code: 'E-INVENTORY-006' } });
    });

    it('items 超上限（>50）→ E-INVENTORY-007', async () => {
      const items = Array.from({ length: 51 }, (_, i) => ({
        skuId: `sku-${i}`,
        quantity: 1,
      }));
      await expect(
        service.transferStock({
          fromWarehouseId: 'wh-1',
          toWarehouseId: 'wh-2',
          items,
        }),
      ).rejects.toMatchObject({ response: { code: 'E-INVENTORY-007' } });
    });
  });

  describe('batchAdjustStock', () => {
    it('超上限（>100）→ E-INVENTORY-008', async () => {
      const items = Array.from({ length: 101 }, (_, i) => ({
        warehouseId: 'wh-1',
        skuId: `sku-${i}`,
        deltaQty: 1,
      }));
      await expect(service.batchAdjustStock(items)).rejects.toMatchObject({
        response: { code: 'E-INVENTORY-008' },
      });
    });

    it('全事务：一条失败全部回滚（adjustStockTx 抛错传播）', async () => {
      // 第一条 deltaQty=1 走 releaseStock（成功），第二条 deltaQty=-1 走 deductStock 失败
      m.stockFindUnique.mockResolvedValue({ warehouseId: 'wh-1', skuId: 'sku-1', quantity: 10 });
      m.releaseStock.mockResolvedValue(undefined);
      m.deductStock.mockResolvedValue(false);

      await expect(
        service.batchAdjustStock([
          { warehouseId: 'wh-1', skuId: 'sku-1', deltaQty: 1 },
          { warehouseId: 'wh-1', skuId: 'sku-2', deltaQty: -1 },
        ]),
      ).rejects.toMatchObject({ response: { code: 'E-INVENTORY-001' } });
    });
  });

  describe('importStocksCsv', () => {
    it('表头缺列 → E-INVENTORY-009', async () => {
      const csv = Buffer.from('warehouseId,skuId\nwh-1,sku-1'); // 缺 deltaQty
      await expect(service.importStocksCsv(csv)).rejects.toMatchObject({
        response: { code: 'E-INVENTORY-009' },
      });
    });

    it('空 CSV → E-INVENTORY-009', async () => {
      await expect(service.importStocksCsv(Buffer.from(''))).rejects.toMatchObject({
        response: { code: 'E-INVENTORY-009' },
      });
    });

    it('逐行解析：deltaQty=0 进 failedRows，合法行调 adjustStock 成功', async () => {
      const csv = Buffer.from(
        'warehouseId,skuId,deltaQty,reason\nwh-1,sku-1,0,zero\nwh-1,sku-2,5,ok',
      );
      m.stockFindUnique.mockResolvedValue({ warehouseId: 'wh-1', skuId: 'sku-2', quantity: 10 });
      m.releaseStock.mockResolvedValue(undefined);

      const result = await service.importStocksCsv(csv);

      expect(result.failedRows).toHaveLength(1);
      expect(result.failedRows[0].row).toBe(2); // sku-1 行（deltaQty=0）
      expect(result.successCount).toBe(1); // sku-2 成功
    });
  });
});
