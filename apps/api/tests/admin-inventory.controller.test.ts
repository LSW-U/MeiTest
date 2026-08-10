/**
 * AdminInventoryController 单测（第五批审查报告 P2-2，2026-08-10）
 *
 * 补 controller 层 e2e（v1 漏审，批次 5 新 5 端点零 controller 测试覆盖）：
 *   - batch-adjust / transfer / transfers / export / import 装配（调 service + 返回 { success, data }）
 *   - batch-adjust/transfer 把 req.user.sub 作 operatorId 透传
 *   - import 把 file.buffer + req.user.sub 透传；无 file → BadRequest
 *
 * service 层（transfer 双仓原子 / CSV escape / import uuid 校验）由 inventory.service.test 覆盖
 *
 * mock：InventoryService class + Response.setHeader + Express.Multer.File（import）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AdminInventoryController } from '../src/modules/inventory/inventory.controller';

const { mockInventoryService } = vi.hoisted(() => ({
  mockInventoryService: {
    listStocks: vi.fn(),
    listStockLogs: vi.fn(),
    adjustStock: vi.fn(),
    batchAdjustStock: vi.fn(),
    transferStock: vi.fn(),
    listTransfers: vi.fn(),
    exportStocksCsv: vi.fn(),
    importStocksCsv: vi.fn(),
  },
}));

vi.mock('../src/modules/inventory/inventory.service', () => ({
  InventoryService: class {
    listStocks = mockInventoryService.listStocks;
    listStockLogs = mockInventoryService.listStockLogs;
    adjustStock = mockInventoryService.adjustStock;
    batchAdjustStock = mockInventoryService.batchAdjustStock;
    transferStock = mockInventoryService.transferStock;
    listTransfers = mockInventoryService.listTransfers;
    exportStocksCsv = mockInventoryService.exportStocksCsv;
    importStocksCsv = mockInventoryService.importStocksCsv;
  },
}));

import { InventoryService } from '../src/modules/inventory/inventory.service';

describe('AdminInventoryController - 5 端点装配（第五批审查 P2-2）', () => {
  let controller: AdminInventoryController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminInventoryController(new InventoryService() as never);
  });

  it('POST /stocks/batch-adjust - 调 inventory.batchAdjustStock 透传 items + req.user.sub 作 operatorId', async () => {
    const mockData = { items: [{ warehouseId: 'wh-1', skuId: 'sku-1', deltaQty: 5, afterQty: 15 }] };
    mockInventoryService.batchAdjustStock.mockResolvedValue(mockData);

    const result = await controller.batchAdjustStock(
      {
        items: [
          { warehouseId: 'wh-1', skuId: 'sku-1', deltaQty: 5, reason: '盘点' },
        ],
      } as never,
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } },
    );

    expect(mockInventoryService.batchAdjustStock).toHaveBeenCalledWith([
      expect.objectContaining({
        warehouseId: 'wh-1',
        skuId: 'sku-1',
        deltaQty: 5,
        reason: '盘点',
        operatorId: 'admin-1',
      }),
    ]);
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /transfer - 调 inventory.transferStock 透传 body + req.user.sub 作 operatorId', async () => {
    const mockData = {
      referenceId: 'ref-1',
      fromWarehouseId: 'wh-1',
      toWarehouseId: 'wh-2',
      items: [{ skuId: 'sku-1', quantity: 3, fromAfterQty: 7, toAfterQty: 3 }],
    };
    mockInventoryService.transferStock.mockResolvedValue(mockData);

    const result = await controller.transferStock(
      {
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [{ skuId: 'sku-1', quantity: 3 }],
        reason: '补货',
      } as never,
      { user: { sub: 'admin-1', role: 'SUPER_ADMIN' } },
    );

    expect(mockInventoryService.transferStock).toHaveBeenCalledWith(
      expect.objectContaining({
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        operatorId: 'admin-1',
      }),
    );
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /transfers - 调 inventory.listTransfers 传 query', async () => {
    const mockData = [
      {
        referenceId: 'ref-1',
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        items: [],
        reason: null,
        operatorId: null,
        createdAt: '2026-08-10T00:00:00.000Z',
      },
    ];
    mockInventoryService.listTransfers.mockResolvedValue(mockData);

    const result = await controller.listTransfers({ limit: 20 } as never);

    expect(mockInventoryService.listTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
    );
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('GET /stocks/export - 调 inventory.exportStocksCsv + res.setHeader + return csv', async () => {
    const mockCsv = 'warehouseId,warehouseCode,skuId,quantity,safetyStock,status';
    mockInventoryService.exportStocksCsv.mockResolvedValue(mockCsv);
    const res = { setHeader: vi.fn() } as never;

    const result = await controller.exportStocksCsv('wh-1', res);

    expect(mockInventoryService.exportStocksCsv).toHaveBeenCalledWith({ warehouseId: 'wh-1' });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining('attachment; filename="stocks-'),
    );
    expect(result).toBe(mockCsv);
  });

  it('POST /stocks/import - 调 inventory.importStocksCsv 传 file.buffer + req.user.sub', async () => {
    const mockData = { successCount: 3, failedRows: [] };
    mockInventoryService.importStocksCsv.mockResolvedValue(mockData);
    const file = { buffer: Buffer.from('warehouseId,skuId,deltaQty\n...') } as never;

    const result = await controller.importStocksCsv(file, {
      user: { sub: 'admin-1', role: 'SUPER_ADMIN' },
    });

    expect(mockInventoryService.importStocksCsv).toHaveBeenCalledWith(
      expect.any(Buffer),
      'admin-1',
    );
    expect(result).toEqual({ success: true, data: mockData });
  });

  it('POST /stocks/import - 无 file → BadRequest（field name 必须为 "file"）', async () => {
    await expect(
      controller.importStocksCsv(undefined, { user: { sub: 'admin-1' } } as never),
    ).rejects.toThrow(BadRequestException);
    expect(mockInventoryService.importStocksCsv).not.toHaveBeenCalled();
  });
});
