/**
 * Inventory 模块 schema（批次 5：admin 批量/调拨）
 *
 * 决策依据：
 * - schema.prisma Stock（含 safetyStock）/ StockLog 已有
 * - W 流程已建基础库存 CRUD（adjustStock/listStocks/listStockLogs）
 * - 批次 5 补：batch-adjust + transfer + CSV 导入导出
 *
 * TDD 强制：库存是 CLAUDE.md §4 TDD 强制模块
 */
import { z } from 'zod';
import { Id } from './common';

// ============================================================================
// batch-adjust（批量调整，全事务）
// ============================================================================

export const BatchAdjustItemRequest = z.object({
  warehouseId: Id,
  skuId: Id,
  /** 正数入库/调增，负数出库/调减（不可 0，adjustStock deltaQty 校验） */
  deltaQty: z.number().int().refine((v) => v !== 0, 'DELTA_QTY_NOT_ZERO'),
  reason: z.string().max(200).optional(),
});

export const BatchAdjustRequest = z.object({
  /** 上限 100（防超大事务），service 层 E-INVENTORY-008 兜底 */
  items: z.array(BatchAdjustItemRequest).min(1).max(100),
});

export const BatchAdjustResultItem = z.object({
  warehouseId: Id,
  skuId: Id,
  deltaQty: z.number().int(),
  afterQty: z.number().int(),
});

export const BatchAdjustResult = z.object({
  items: z.array(BatchAdjustResultItem),
});

// ============================================================================
// transfer（仓库间调拨，双仓原子）
// ============================================================================

export const TransferItem = z.object({
  skuId: Id,
  quantity: z.number().int().positive(),
});

export const TransferRequest = z.object({
  fromWarehouseId: Id,
  toWarehouseId: Id,
  /** 上限 50（单次调拨 SKU 数） */
  items: z.array(TransferItem).min(1).max(50),
  reason: z.string().max(200).optional(),
});

export const TransferResultItem = z.object({
  skuId: Id,
  quantity: z.number().int(),
  fromAfterQty: z.number().int(),
  toAfterQty: z.number().int(),
});

export const TransferResult = z.object({
  /** 串联两条 StockLog 的 uuid（source OUTBOUND + target INBOUND） */
  referenceId: Id,
  fromWarehouseId: Id,
  toWarehouseId: Id,
  items: z.array(TransferResultItem),
});

// ============================================================================
// transfers list（调拨记录，按 referenceId 聚合 StockLog）
// ============================================================================

export const ListTransfersQuery = z.object({
  fromWarehouseId: Id.optional(),
  toWarehouseId: Id.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const TransferRecordItem = z.object({
  skuId: Id,
  quantity: z.number().int(),
});

export const TransferRecord = z.object({
  referenceId: Id,
  fromWarehouseId: Id,
  toWarehouseId: Id,
  items: z.array(TransferRecordItem),
  reason: z.string().nullable(),
  operatorId: Id.nullable(),
  createdAt: z.string(),
});

// ============================================================================
// CSV 导入（multipart，返部分成功）
// ============================================================================

export const ImportFailedRow = z.object({
  /** CSV 行号（从 1 起，0 = 表头错） */
  row: z.number().int(),
  error: z.string(),
});

export const ImportResult = z.object({
  successCount: z.number().int(),
  failedRows: z.array(ImportFailedRow),
});
