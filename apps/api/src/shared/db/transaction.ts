/**
 * 事务封装（Prisma 5 interactive transaction）
 *
 * 决策依据：CLAUDE.md §业务决策 4 — MVP 下单走同步事务 + DB 行锁防超卖
 * - 调用方传 fn，fn 内拿 tx 做多步操作，任一步抛错自动回滚
 * - Stock 表 WHERE warehouse_id=? AND sku_id=? AND quantity>=? FOR UPDATE 通过 raw SQL 实现
 *
 * 用法：
 *   await withTransaction(async (tx) => {
 *     const order = await tx.order.create({...});
 *     await tx.stock.updateMany({...});
 *   });
 */
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

/**
 * 扣库存（行锁防超卖）— 用于下单流程
 *
 * 决策依据：契约 v0.3 冲突 6 + schema.prisma Stock 表
 *   UPDATE stocks SET quantity = quantity - ? WHERE warehouse_id=? AND sku_id=? AND quantity >= ?
 *   返回 affected rows：1 = 成功，0 = 库存不足
 */
export async function deductStock(
  tx: Tx,
  warehouseId: string,
  skuId: string,
  quantity: number,
): Promise<boolean> {
  const result = await tx.$executeRaw`
    UPDATE "stocks"
    SET quantity = quantity - ${quantity}
    WHERE warehouse_id = ${warehouseId}
      AND sku_id = ${skuId}
      AND quantity >= ${quantity}
  `;
  return result > 0;
}
