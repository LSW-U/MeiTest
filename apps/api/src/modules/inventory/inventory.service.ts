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
import { Injectable, NotFoundException } from '@nestjs/common';
import { db, withTransaction, deductStock, releaseStock, type Tx } from '../../shared/db';
import { findWarehouseByPoint } from '../../shared/db/postgis-helpers';

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
      return { warehouse: null, quantity: 0, inStock: false, outOfRange: true };
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
    const where: { warehouseId?: string; quantity?: { lt: number } } = {};
    if (filter.warehouseId) where.warehouseId = filter.warehouseId;
    if (filter.lowStockOnly) where.quantity = { lt: 10 }; // 默认安全库存阈值 10

    return db.stock.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
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

  /** 手动调整库存（正负皆可，写入 StockLog 审计） */
  async adjustStock(input: StockAdjustInput) {
    if (input.deltaQty === 0) {
      throw new Error('STOCK_QTY_INVALID: deltaQty cannot be 0');
    }
    return withTransaction(async (tx) => {

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
          throw new Error('STOCK_RECORD_NOT_FOUND');
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
          throw new Error('STOCK_NOT_ENOUGH');
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
    });
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
}
