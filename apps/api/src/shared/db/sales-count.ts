/**
 * 销量真实统计（商品详情整合 批A 2026-09-07）
 *
 * salesCount 累加 / 回滚 / 审计三件套，全部在调用方事务内执行：
 *   - 累加：order.service markPaidTx（预付三条 PAID 路径单点）
 *          + dispatch.service deliverTask（COD 送达收款 DELIVERED_PAID）
 *   - 回滚：refund.service completeRefundTx（autoApprove + review approve 共用单点）
 *   - 审计：SalesCountLog（before/after 全程留痕，历史假数据保留不清零）
 *
 * 为什么用 raw SQL 而不是 prisma update increment：
 *   1. 回滚需要「sales_count >= 扣减量才执行」的原子守卫（防并发双退款减穿 0），
 *      prisma updateMany 无返回值拿不到 afterQty 写审计；raw RETURNING 一条语句同时拿到
 *   2. UPDATE 行锁天然防并发，RETURNING 的 after 即锁定后的最新值，before 可精确倒推
 *   3. OrderItem.productId / RefundItem.skuId 均无 FK 约束（快照设计），商品缺失时
 *      raw 静默 0 行跳过；prisma update 会抛 P2025 中断支付/退款主流程
 */
import { logger } from '../logger/logger';
import type { Tx } from './transaction';

/** 销量操作上下文 */
export interface SalesCountOperatorOptions {
  /** 操作人 userId（系统动作 / 支付回调可空） */
  operatorId?: string | null;
}

/** 单条销量变更原子应用（守卫 + RETURNING + 审计），返回 false = 被跳过 */
async function applySalesCountChange(
  tx: Tx,
  params: {
    productId: string;
    /** 变更量：正=累加 负=回滚 */
    delta: number;
    orderId?: string | null;
    changeType: 'ORDER' | 'REFUND' | 'ADMIN_ADJUST';
    operatorId?: string | null;
  },
): Promise<boolean> {
  const { productId, delta, orderId, changeType, operatorId } = params;

  // 回滚方向加守卫：sales_count >= 扣减量才执行（防越界减到负数）
  const rows =
    delta >= 0
      ? await tx.$queryRaw<Array<{ sales_count: number }>>`
          UPDATE "products" SET "sales_count" = "sales_count" + ${delta}
          WHERE "id" = ${productId}
          RETURNING "sales_count"`
      : await tx.$queryRaw<Array<{ sales_count: number }>>`
          UPDATE "products" SET "sales_count" = "sales_count" + ${delta}
          WHERE "id" = ${productId} AND "sales_count" >= ${-delta}
          RETURNING "sales_count"`;

  if (rows.length === 0) {
    // 商品不存在（productId 无 FK，理论可能）或存量不足被守卫拒绝 → 跳过该商品，不中断主流程
    logger.warn({
      msg: 'SALES_COUNT_CHANGE_SKIPPED',
      productId,
      delta,
      changeType,
      orderId: orderId ?? null,
    });
    return false;
  }

  const afterQty = rows[0]!.sales_count;
  const beforeQty = afterQty - delta;
  await tx.salesCountLog.create({
    data: {
      productId,
      orderId: orderId ?? null,
      changeType,
      changeQty: delta,
      beforeQty,
      afterQty,
      operatorId: operatorId ?? null,
    },
  });
  return true;
}

/**
 * 支付成功累加：按订单行 OrderItem.productId × quantity 聚合累加
 *
 * 同 productId 多行合并（同商品多 SKU / 同 SKU 多行只写一条审计）
 * 调用方：markPaidTx（预付）/ deliverTask（COD 送达收款），均在订单状态推进同事务内
 * 幂等：由调用方状态机守卫（markPaidTx paymentStatus=PAID 提前 return /
 *       deliverTask task 状态断言 PICKED_UP/DELIVERING 一次性）
 */
export async function incrementSalesCountForOrder(
  tx: Tx,
  orderId: string,
  options: SalesCountOperatorOptions = {},
): Promise<void> {
  const items = await tx.orderItem.findMany({
    where: { orderId },
    select: { productId: true, quantity: true },
  });

  const qtyByProduct = new Map<string, number>();
  for (const item of items) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.quantity);
  }

  for (const [productId, qty] of qtyByProduct) {
    await applySalesCountChange(tx, {
      productId,
      delta: qty,
      orderId,
      changeType: 'ORDER',
      operatorId: options.operatorId ?? null,
    });
  }
}

/**
 * 部分退款回滚：RefundItem.skuId → Sku.productId × refundQty 递减
 *
 * RefundItem 无 productId（P13 设计），经 Sku 定位商品
 * 守卫见 applySalesCountChange：sales_count >= refundQty 才减，防越界
 */
export async function rollbackSalesCountForRefundItems(
  tx: Tx,
  orderId: string,
  items: Array<{ skuId: string; refundQty: number }>,
  options: SalesCountOperatorOptions = {},
): Promise<void> {
  if (items.length === 0) return;

  const skus = await tx.sku.findMany({
    where: { id: { in: items.map((i) => i.skuId) } },
    select: { id: true, productId: true },
  });
  const productIdBySku = new Map(skus.map((s) => [s.id, s.productId]));

  for (const item of items) {
    const productId = productIdBySku.get(item.skuId);
    if (!productId) {
      // RefundItem.skuId 无 FK（快照设计），SKU 缺失跳过该行
      logger.warn({
        msg: 'SALES_COUNT_ROLLBACK_SKU_NOT_FOUND',
        orderId,
        skuId: item.skuId,
      });
      continue;
    }
    await applySalesCountChange(tx, {
      productId,
      delta: -item.refundQty,
      orderId,
      changeType: 'REFUND',
      operatorId: options.operatorId ?? null,
    });
  }
}

/**
 * 整单退款回滚（退款单 RefundItem 为空数组时走此路径）：
 * 按 OrderItem 剩余未回滚数量递减
 *
 * remaining = OrderItem.quantity − 该 orderItemId 已 COMPLETED 退款的 refundQty 合计
 * （与 createRefund 部分退款累计校验同口径，防「部分退款后再整单退款」重复回滚；
 *   只统计 COMPLETED：PENDING/APPROVED 还没回滚过，REJECTED/CANCELLED 永远不会）
 */
export async function rollbackSalesCountForFullOrder(
  tx: Tx,
  orderId: string,
  options: SalesCountOperatorOptions = {},
): Promise<void> {
  const orderItems = await tx.orderItem.findMany({
    where: { orderId },
    select: { id: true, productId: true, quantity: true },
  });
  if (orderItems.length === 0) return;

  const refundedItems = await tx.refundItem.findMany({
    where: {
      orderItemId: { in: orderItems.map((oi) => oi.id) },
      refund: { orderId, status: 'COMPLETED' },
    },
    select: { orderItemId: true, refundQty: true },
  });
  const refundedByItem = new Map<string, number>();
  for (const ri of refundedItems) {
    refundedByItem.set(ri.orderItemId, (refundedByItem.get(ri.orderItemId) ?? 0) + ri.refundQty);
  }

  for (const oi of orderItems) {
    const remaining = oi.quantity - (refundedByItem.get(oi.id) ?? 0);
    if (remaining <= 0) continue;
    await applySalesCountChange(tx, {
      productId: oi.productId,
      delta: -remaining,
      orderId,
      changeType: 'REFUND',
      operatorId: options.operatorId ?? null,
    });
  }
}

/**
 * 管理端批量调整（批C：PATCH /admin/products/sales-batch）
 *
 * 语义是「设值」非「增量」：先读 current 推导 delta = target − current，
 * 复用 applySalesCountChange 写 SalesCountLog（changeType=ADMIN_ADJUST），
 * before/after 全程留痕，与批A 审计口径一致。
 *
 * - 目标值与当前相同（delta=0）：不动库不写日志，计为 adjusted（确认语义）
 * - 商品不存在：跳过该条（计入 skipped），不中断同批其他商品
 * - target 由契约校验 >= 0，delta >= -current，负向守卫不会触发
 */
export async function adjustSalesCountForAdmin(
  tx: Tx,
  items: Array<{ productId: string; salesCount: number }>,
  options: SalesCountOperatorOptions = {},
): Promise<{ adjusted: string[]; skipped: string[] }> {
  const adjusted: string[] = [];
  const skipped: string[] = [];

  for (const item of items) {
    const current = await tx.product.findUnique({
      where: { id: item.productId },
      select: { salesCount: true },
    });
    if (!current) {
      skipped.push(item.productId);
      continue;
    }
    const delta = item.salesCount - current.salesCount;
    if (delta === 0) {
      adjusted.push(item.productId);
      continue;
    }
    const ok = await applySalesCountChange(tx, {
      productId: item.productId,
      delta,
      changeType: 'ADMIN_ADJUST',
      operatorId: options.operatorId ?? null,
    });
    (ok ? adjusted : skipped).push(item.productId);
  }

  return { adjusted, skipped };
}
