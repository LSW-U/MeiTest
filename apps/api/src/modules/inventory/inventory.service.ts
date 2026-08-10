/**
 * Inventory Service（W 流程 2026-06-24）
 *
 * 核心算法：
 *   - matchWarehouse(lat, lng) — 按 PostGIS 收货地址匹配最近仓库
 *   - getStockByAddress(skuId, lat, lng) — 切地址时刷新库存（前端关键 UX）
 *
 * 内部 helper（被 C 流程 order 模块调用）：
 *   - reserveStock(warehouseId, items, tx) — 复用 deductStock（行锁防超卖）
 *   - releaseStock(warehouseId, items, tx) — 复用 releaseStock
 *
 * 后台 CRUD：
 *   - listStocks(warehouseId?) — 库存列表
 *   - adjustStock(warehouseId, skuId, deltaQty, reason) — 手动调整
 *   - listStockLogs(filter) — 变更日志
 *
 * 决策：
 *   - 所有写库存操作走 withTransaction（保证 StockLog 与 Stock 一致）
 *   - 库存不存在时按需创建（首次入库用）
 */
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { db, withTransaction, deductStock, releaseStock, type Tx } from '../../shared/db';
import { findWarehouseByPoint } from '../../shared/db/postgis-helpers';
import { randomUUID } from 'node:crypto';

/** 调拨记录（listTransfers 返回，按 referenceId 聚合 StockLog） */
export interface TransferRecord {
  referenceId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: Array<{ skuId: string; quantity: number }>;
  reason: string | null;
  operatorId: string | null;
  createdAt: string;
}

export interface StockAdjustInput {
  warehouseId: string;
  skuId: string;
  /** 正数入库/调增，负数出库/调减 */
  deltaQty: number;
  reason?: string;
  operatorId?: string;
}

@Injectable()
export class InventoryService {
  // ===== 客户端：地址匹配 =====

  /** 按收货地址匹配最近仓库（PostGIS ST_Within + ST_Distance） */
  async matchWarehouse(lat: number, lng: number) {
    const match = await findWarehouseByPoint(db, lng, lat);
    if (!match) {
      return null;
    }
    return {
      warehouseId: match.id,
      code: match.code,
      name: match.name as Record<string, string>,
      deliveryFee: match.deliveryFee,
      distance: Number(match.distance),
    };
  }

  /** 切地址时获取某 SKU 的库存（前端 UX 关键：切地址 → 重新查询库存） */
  async getStockByAddress(skuId: string, lat: number, lng: number) {
    const warehouse = await this.matchWarehouse(lat, lng);
    if (!warehouse) {
      return {
        warehouse: null,
        quantity: 0,
        inStock: false,
        outOfRange: true,
        code: 'E-INVENTORY-002' as const,
      };
    }
    const stock = await db.stock.findUnique({
      where: { warehouseId_skuId: { warehouseId: warehouse.warehouseId, skuId } },
    });
    const quantity = stock?.quantity ?? 0;
    return {
      warehouse,
      quantity,
      inStock: quantity > 0,
      outOfRange: false,
      code: null,
    };
  }

  /** 批量获取多个 SKU 在指定仓库的库存（购物车 / 商品列表用） */
  async getStocksByWarehouse(warehouseId: string, skuIds: string[]) {
    const stocks = await db.stock.findMany({
      where: { warehouseId, skuId: { in: skuIds } },
    });
    const map = new Map<string, number>();
    for (const s of stocks) {
      map.set(s.skuId, s.quantity);
    }
    return skuIds.map((skuId) => ({
      skuId,
      quantity: map.get(skuId) ?? 0,
      inStock: (map.get(skuId) ?? 0) > 0,
    }));
  }

  // ===== 后台：库存管理 =====

  async listStocks(filter: { warehouseId?: string; lowStockOnly?: boolean } = {}) {
    const where: { warehouseId?: string } = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;

    const stocks = await db.stock.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    if (filter.lowStockOnly) {
      // 修复（批次 5）：用 stock.safetyStock 字段（每条自带阈值），非硬编码 10
      // Prisma where 不支持 column<=column，用 JS filter（500 条上限内可接受）
      return stocks.filter((s) => s.quantity <= s.safetyStock);
    }
    return stocks;
  }

  async listStockLogs(filter: { warehouseId?: string; skuId?: string; limit?: number } = {}) {
    return db.stockLog.findMany({
      where: {
        ...(filter.warehouseId && { warehouseId: filter.warehouseId }),
        ...(filter.skuId && { skuId: filter.skuId }),
      },
      orderBy: { createdAt: 'desc' },
      take: filter.limit ?? 100,
    });
  }

  /**
   * 手动调整库存的事务核心（不含 withTransaction 包装，供 batchAdjustStock 复用）
   *
   * 复用批次 3 markPaidTx 模式：抽 tx 版本，adjustStock + batchAdjustStock 共享核心
   */
  async adjustStockTx(tx: Tx, input: StockAdjustInput) {
    if (input.deltaQty === 0) {
      throw new BadRequestException({
        code: 'E-INVENTORY-003',
        message: 'Stock adjust deltaQty cannot be 0',
      });
    }

    // 库存不存在时先 create（首次入库）
    const existing = await tx.stock.findUnique({
      where: {
        warehouseId_skuId: {
          warehouseId: input.warehouseId,
          skuId: input.skuId,
        },
      },
    });
    if (!existing) {
      if (input.deltaQty < 0) {
        throw new NotFoundException({
          code: 'E-INVENTORY-004',
          message: 'Stock record not found (cannot deduct from non-existent stock)',
        });
      }
      // 入库创建
      const created = await tx.stock.create({
        data: {
          warehouseId: input.warehouseId,
          skuId: input.skuId,
          quantity: input.deltaQty,
        },
      });
      await tx.stockLog.create({
        data: {
          warehouseId: input.warehouseId,
          skuId: input.skuId,
          changeType: 'INBOUND',
          changeQty: input.deltaQty,
          beforeQty: 0,
          afterQty: input.deltaQty,
          reason: input.reason ?? 'manual inbound',
          referenceType: 'ADJUST',
          operatorId: input.operatorId,
        },
      });
      return created;
    }

    // 已有库存记录：用 deductStock / releaseStock 保证行锁 + StockLog
    if (input.deltaQty > 0) {
      await releaseStock(tx, input.warehouseId, input.skuId, input.deltaQty, 'RELEASE', {
        reason: input.reason ?? 'manual adjust (+)',
        referenceType: 'ADJUST',
        operatorId: input.operatorId,
      });
    } else {
      const ok = await deductStock(tx, input.warehouseId, input.skuId, -input.deltaQty, {
        reason: input.reason ?? 'manual adjust (-)',
        referenceType: 'ADJUST',
        operatorId: input.operatorId,
      });
      if (!ok) {
        throw new BadRequestException({
          code: 'E-INVENTORY-001',
          message: 'Stock is not enough',
        });
      }
    }

    return tx.stock.findUnique({
      where: {
        warehouseId_skuId: {
          warehouseId: input.warehouseId,
          skuId: input.skuId,
        },
      },
    });
  }

  /** 手动调整库存（正负皆可，写入 StockLog 审计） */
  async adjustStock(input: StockAdjustInput) {
    return withTransaction(async (tx) => this.adjustStockTx(tx, input));
  }

  // ===== 内部 helper（被 C 流程 order 模块调用） =====

  /**
   * 批量扣库存（下单时用）
   *
   * @returns { success: boolean, failedSkuId?: string }
   *   success=true: 全部扣减成功
   *   success=false: failedSkuId 是库存不足的 SKU（调用方决定是否 throw）
   */
  async reserveStock(
    tx: Tx,
    warehouseId: string,
    items: Array<{ skuId: string; quantity: number }>,
    context: { reason?: string; referenceType?: string; referenceId?: string; operatorId?: string } = {},
  ): Promise<{ success: boolean; failedSkuId?: string }> {
    for (const item of items) {
      const ok = await deductStock(tx, warehouseId, item.skuId, item.quantity, context);
      if (!ok) {
        return { success: false, failedSkuId: item.skuId };
      }
    }
    return { success: true };
  }

  /** 批量回库存（取消/退款时用） */
  async releaseReservedStock(
    tx: Tx,
    warehouseId: string,
    items: Array<{ skuId: string; quantity: number }>,
    changeType: 'RELEASE' | 'RETURN' = 'RELEASE',
    context: { reason?: string; referenceType?: string; referenceId?: string; operatorId?: string } = {},
  ): Promise<void> {
    for (const item of items) {
      await releaseStock(tx, warehouseId, item.skuId, item.quantity, changeType, context);
    }
  }

  // ===== 批次 5：批量调整 + 调拨 + CSV =====

  /**
   * 批量调整库存（全事务：一条失败全部回滚，上限 100）
   *
   * 复用 adjustStockTx（tx 版本），避免嵌套事务（批次 3 markPaidTx 模式）
   */
  async batchAdjustStock(items: StockAdjustInput[]): Promise<{
    items: Array<{ warehouseId: string; skuId: string; deltaQty: number; afterQty: number }>;
  }> {
    if (items.length > 100) {
      throw new BadRequestException({
        code: 'E-INVENTORY-008',
        message: `Batch adjust items exceed limit (max 100, got ${items.length})`,
      });
    }
    return withTransaction(async (tx) => {
      const results: Array<{
        warehouseId: string;
        skuId: string;
        deltaQty: number;
        afterQty: number;
      }> = [];
      for (const item of items) {
        const stock = await this.adjustStockTx(tx, item);
        results.push({
          warehouseId: item.warehouseId,
          skuId: item.skuId,
          deltaQty: item.deltaQty,
          afterQty: stock?.quantity ?? 0,
        });
      }
      return { items: results };
    });
  }

  /**
   * 仓库间调拨（双仓原子，TDD 强制核心）
   *
   * 事务编排：withTransaction 包 deductStock(源 OUTBOUND) + 目标仓 create/update(INBOUND)
   *   - referenceType='TRANSFER' + referenceId=uuid 串联两条 StockLog
   *   - 目标仓 stock 不存在则创建（A 决策）
   *   - 源仓不足抛 E-INVENTORY-001，整事务回滚（目标仓无变化）
   */
  async transferStock(input: {
    fromWarehouseId: string;
    toWarehouseId: string;
    items: Array<{ skuId: string; quantity: number }>;
    reason?: string;
    operatorId?: string;
  }): Promise<{
    referenceId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    items: Array<{ skuId: string; quantity: number; fromAfterQty: number; toAfterQty: number }>;
  }> {
    if (input.fromWarehouseId === input.toWarehouseId) {
      throw new BadRequestException({
        code: 'E-INVENTORY-005',
        message: 'Transfer from/to must be different warehouses',
      });
    }
    if (input.items.length === 0) {
      throw new BadRequestException({
        code: 'E-INVENTORY-006',
        message: 'Transfer items cannot be empty',
      });
    }
    if (input.items.length > 50) {
      throw new BadRequestException({
        code: 'E-INVENTORY-007',
        message: `Transfer items exceed limit (max 50, got ${input.items.length})`,
      });
    }

    const referenceId = randomUUID();
    const ctx = {
      reason: input.reason ?? 'transfer',
      referenceType: 'TRANSFER',
      referenceId,
      operatorId: input.operatorId,
    };

    return withTransaction(async (tx) => {
      const results: Array<{
        skuId: string;
        quantity: number;
        fromAfterQty: number;
        toAfterQty: number;
      }> = [];

      for (const item of input.items) {
        // 1. 源仓扣减（deductStock 行锁防超卖，OUTBOUND log）
        const ok = await deductStock(tx, input.fromWarehouseId, item.skuId, item.quantity, ctx);
        if (!ok) {
          throw new BadRequestException({
            code: 'E-INVENTORY-001',
            message: `Transfer source stock not enough (skuId=${item.skuId})`,
          });
        }

        // 2. 目标仓增加（stock 不存在则创建 + INBOUND log，A 决策）
        const target = await tx.stock.findUnique({
          where: {
            warehouseId_skuId: {
              warehouseId: input.toWarehouseId,
              skuId: item.skuId,
            },
          },
        });
        let toAfterQty: number;
        if (!target) {
          await tx.stock.create({
            data: {
              warehouseId: input.toWarehouseId,
              skuId: item.skuId,
              quantity: item.quantity,
            },
          });
          toAfterQty = item.quantity;
        } else {
          // raw SQL UPDATE（行锁，避免读改写竞态）
          await tx.$executeRaw`
            UPDATE "stocks"
            SET quantity = quantity + ${item.quantity}
            WHERE warehouse_id = ${input.toWarehouseId} AND sku_id = ${item.skuId}
          `;
          toAfterQty = target.quantity + item.quantity;
        }

        // 目标仓 INBOUND log（与源仓 OUTBOUND 共享 referenceId 串联）
        await tx.stockLog.create({
          data: {
            warehouseId: input.toWarehouseId,
            skuId: item.skuId,
            changeType: 'INBOUND',
            changeQty: item.quantity,
            beforeQty: target ? target.quantity : 0,
            afterQty: toAfterQty,
            reason: input.reason ?? 'transfer in',
            referenceType: 'TRANSFER',
            referenceId,
            operatorId: input.operatorId,
          },
        });

        // 源仓 after（deductStock 已 update，查一下）
        const fromStock = await tx.stock.findUnique({
          where: {
            warehouseId_skuId: {
              warehouseId: input.fromWarehouseId,
              skuId: item.skuId,
            },
          },
          select: { quantity: true },
        });

        results.push({
          skuId: item.skuId,
          quantity: item.quantity,
          fromAfterQty: fromStock?.quantity ?? 0,
          toAfterQty,
        });
      }

      return {
        referenceId,
        fromWarehouseId: input.fromWarehouseId,
        toWarehouseId: input.toWarehouseId,
        items: results,
      };
    });
  }

  /**
   * 调拨记录列表（查 StockLog referenceType='TRANSFER'，按 referenceId 聚合）
   *
   * OUTBOUND log → fromWarehouseId；INBOUND log → toWarehouseId；同 referenceId 聚合
   */
  async listTransfers(filter: {
    fromWarehouseId?: string;
    toWarehouseId?: string;
    limit?: number;
  } = {}): Promise<TransferRecord[]> {
    const limit = filter.limit ?? 50;
    // 每个 transfer 至少 2 条 log（源 OUTBOUND + 目标 INBOUND），多取以覆盖聚合
    const logs = await db.stockLog.findMany({
      where: { referenceType: 'TRANSFER' },
      orderBy: { createdAt: 'desc' },
      take: limit * 4,
    });

    const map = new Map<string, TransferRecord>();
    for (const log of logs) {
      const refId = log.referenceId!;
      let record = map.get(refId);
      if (!record) {
        record = {
          referenceId: refId,
          fromWarehouseId: '',
          toWarehouseId: '',
          items: [],
          reason: log.reason ?? null,
          operatorId: log.operatorId ?? null,
          createdAt: log.createdAt.toISOString(),
        };
        map.set(refId, record);
      }
      if (log.changeType === 'OUTBOUND') {
        record.fromWarehouseId = log.warehouseId;
        // OUTBOUND changeQty 是负数（deductStock 写 -qty），取绝对值
        if (!record.items.find((i) => i.skuId === log.skuId)) {
          record.items.push({ skuId: log.skuId, quantity: Math.abs(log.changeQty) });
        }
      } else if (log.changeType === 'INBOUND') {
        record.toWarehouseId = log.warehouseId;
      }
    }

    let records = Array.from(map.values());
    if (filter.fromWarehouseId) {
      records = records.filter((r) => r.fromWarehouseId === filter.fromWarehouseId);
    }
    if (filter.toWarehouseId) {
      records = records.filter((r) => r.toWarehouseId === filter.toWarehouseId);
    }
    return records.slice(0, limit);
  }

  /**
   * 导出库存快照 CSV（warehouseId,warehouseCode,skuId,quantity,safetyStock,status）
   *
   * status: LOW（quantity <= safetyStock）/ OK
   * 注：SKU 表无 code 字段，用 skuId（UUID）标识
   */
  async exportStocksCsv(filter: { warehouseId?: string } = {}): Promise<string> {
    const stocks = await db.stock.findMany({
      where: filter.warehouseId ? { warehouseId: filter.warehouseId } : {},
      orderBy: { updatedAt: 'desc' },
      take: 10000,
      include: {
        warehouse: { select: { code: true } },
      },
    });
    const header = 'warehouseId,warehouseCode,skuId,quantity,safetyStock,status';
    const rows = stocks.map((s) => {
      const status = s.quantity <= s.safetyStock ? 'LOW' : 'OK';
      return [
        s.warehouseId,
        s.warehouse.code,
        s.skuId,
        s.quantity,
        s.safetyStock,
        status,
      ].join(',');
    });
    return [header, ...rows].join('\n');
  }

  /**
   * 导入批量调整 CSV（表头：warehouseId,skuId,deltaQty,reason?）
   *
   * 逐条 adjustStock（独立事务），失败收集 failedRows（部分成功语义，不阻塞成功的）
   * 与 batchAdjustStock（全事务）语义不同 —— CSV 导入容忍单行错误
   */
  async importStocksCsv(
    buffer: Buffer,
    operatorId?: string,
  ): Promise<{
    successCount: number;
    failedRows: Array<{ row: number; error: string }>;
  }> {
    const text = buffer.toString('utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length === 0) {
      throw new BadRequestException({
        code: 'E-INVENTORY-009',
        message: 'CSV is empty',
      });
    }

    const header = lines[0]!.toLowerCase().trim().split(',').map((h) => h.trim());
    const idxWh = header.indexOf('warehouseid');
    const idxSku = header.indexOf('skuid');
    const idxDelta = header.indexOf('deltaqty');
    const idxReason = header.indexOf('reason');
    if (idxWh < 0 || idxSku < 0 || idxDelta < 0) {
      throw new BadRequestException({
        code: 'E-INVENTORY-009',
        message: 'CSV header must contain: warehouseId,skuId,deltaQty (reason optional)',
      });
    }

    const parsed: Array<{ item: StockAdjustInput; row: number }> = [];
    const failedRows: Array<{ row: number; error: string }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i]!.split(',').map((c) => c.trim());
      const row = i + 1; // CSV 行号（含表头，1-based）
      const warehouseId = cols[idxWh];
      const skuId = cols[idxSku];
      const deltaQtyStr = cols[idxDelta];
      const reason = idxReason >= 0 ? cols[idxReason] : undefined;

      if (!warehouseId || !skuId || !deltaQtyStr) {
        failedRows.push({
          row,
          error: 'missing required field (warehouseId/skuId/deltaQty)',
        });
        continue;
      }
      const deltaQty = Number(deltaQtyStr);
      if (!Number.isInteger(deltaQty)) {
        failedRows.push({ row, error: `deltaQty not integer: ${deltaQtyStr}` });
        continue;
      }
      if (deltaQty === 0) {
        failedRows.push({ row, error: 'deltaQty cannot be 0' });
        continue;
      }
      parsed.push({
        item: {
          warehouseId,
          skuId,
          deltaQty,
          reason: reason || undefined,
          operatorId,
        },
        row,
      });
    }

    let successCount = 0;
    for (const { item, row } of parsed) {
      try {
        await this.adjustStock(item);
        successCount++;
      } catch (e) {
        failedRows.push({ row, error: (e as Error).message });
      }
    }

    return { successCount, failedRows };
  }
}
