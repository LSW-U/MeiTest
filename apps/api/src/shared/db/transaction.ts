/**
 * 事务封装（Prisma 5 interactive transaction）
 *
 * 决策依据：CLAUDE.md §业务决策 4 — MVP 下单走同步事务 + DB 行锁防超卖
 * - 调用方传 fn，fn 内拿 tx 做多步操作，任一步抛错自动回滚
 * - Stock 表 WHERE warehouse_id=? AND sku_id=? AND quantity>=? 通过 raw SQL 实现
 *
 * 用法：
 *   await withTransaction(async (tx) => {
 *     const order = await tx.order.create({...});
 *     await deductStock(tx, order.warehouseId, skuId, qty, {
 *       reason: 'order create',
 *       referenceType: 'ORDER',
 *       referenceId: order.id,
 *       operatorId: order.userId,
 *     });
 *   });
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { db } from './prisma';

export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /** 超时（毫秒），默认 10000 */
  timeoutMs?: number;
  /** 隔离级别，默认 ReadCommitted（适合下单/扣库存场景） */
  isolationLevel?: 'ReadCommitted' | 'Serializable' | 'RepeatableRead';
}

/**
 * 在数据库事务中执行 fn。任一步抛错自动回滚。
 *
 * 默认 ReadCommitted（PostgreSQL 默认）。Serializable 用于关键支付场景。
 */
export async function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return db.$transaction(fn, {
    timeout: options?.timeoutMs ?? 10_000,
    isolationLevel:
      options?.isolationLevel === 'Serializable'
        ? Prisma.TransactionIsolationLevel.Serializable
        : options?.isolationLevel === 'RepeatableRead'
          ? Prisma.TransactionIsolationLevel.RepeatableRead
          : Prisma.TransactionIsolationLevel.ReadCommitted,
  });
}

/** 库存变更上下文（写入 StockLog 审计字段） */
export interface StockChangeContext {
  /** 变更原因（可读字符串，写入 reason 字段） */
  reason?: string;
  /** 操作人 userId（管理员手动调整时填，系统自动时省略） */
  operatorId?: string;
  /** 引用类型：'ORDER' / 'ADJUST' / 'INITIAL' / 'RETURN' 等 */
  referenceType?: string;
  /** 引用 ID：orderId / adjustId / null */
  referenceId?: string;
}

/**
 * 扣库存（行锁防超卖 + SKU 状态联检 + StockLog 审计）— 用于下单流程
 *
 * 决策依据：契约 v0.3 冲突 6 + schema.prisma Stock/StockLog 表
 *
 * 实现：
 *   1. UPDATE ... WHERE quantity >= ? AND EXISTS(SKU ACTIVE) RETURNING quantity
 *      （行锁 + 拿到更新后数量 + 防 TOCTOU：A 下单中 → B 下架 SKU → A 事务失败）
 *   2. INSERT StockLog（changeType=OUTBOUND，beforeQty / afterQty 自动计算）
 *
 * @returns true = 扣减成功 / false = 库存不足或 SKU 已下架（事务继续，调用方决定是否 throw）
 */
export async function deductStock(
  tx: Tx,
  warehouseId: string,
  skuId: string,
  quantity: number,
  context: StockChangeContext = {},
): Promise<boolean> {
  if (quantity <= 0) {
    throw new BadRequestException({
      code: 'E-INVENTORY-003',
      message: `Stock quantity must be > 0 (got ${quantity})`,
    });
  }

  const result = await tx.$queryRaw<Array<{ quantity: number }>>`
    UPDATE "stocks"
    SET quantity = quantity - ${quantity}
    WHERE warehouse_id = ${warehouseId}
      AND sku_id = ${skuId}
      AND quantity >= ${quantity}
      AND EXISTS (
        SELECT 1 FROM "skus"
        WHERE id = ${skuId} AND status = 'ACTIVE'
      )
    RETURNING quantity
  `;

  if (result.length === 0) {
    return false;
  }

  const afterQty = result[0].quantity;
  const beforeQty = afterQty + quantity;

  await tx.stockLog.create({
    data: {
      warehouseId,
      skuId,
      changeType: 'OUTBOUND',
      changeQty: -quantity,
      beforeQty,
      afterQty,
      reason: context.reason,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      operatorId: context.operatorId,
    },
  });

  return true;
}

/**
 * 回滚库存（订单取消 / 退货时用）
 *
 * 与 deductStock 对称：quantity > 0 加回库存 + StockLog changeType=RELEASE 或 RETURN
 */
export async function releaseStock(
  tx: Tx,
  warehouseId: string,
  skuId: string,
  quantity: number,
  changeType: 'RELEASE' | 'RETURN' = 'RELEASE',
  context: StockChangeContext = {},
): Promise<void> {
  if (quantity <= 0) {
    throw new BadRequestException({
      code: 'E-INVENTORY-003',
      message: `Stock quantity must be > 0 (got ${quantity})`,
    });
  }

  const result = await tx.$queryRaw<Array<{ quantity: number }>>`
    UPDATE "stocks"
    SET quantity = quantity + ${quantity}
    WHERE warehouse_id = ${warehouseId}
      AND sku_id = ${skuId}
    RETURNING quantity
  `;

  if (result.length === 0) {
    throw new NotFoundException({
      code: 'E-INVENTORY-004',
      message: `Stock record not found (warehouseId=${warehouseId} skuId=${skuId})`,
    });
  }

  const afterQty = result[0].quantity;
  const beforeQty = afterQty - quantity;

  await tx.stockLog.create({
    data: {
      warehouseId,
      skuId,
      changeType,
      changeQty: quantity,
      beforeQty,
      afterQty,
      reason: context.reason,
      referenceType: context.referenceType,
      referenceId: context.referenceId,
      operatorId: context.operatorId,
    },
  });
}
