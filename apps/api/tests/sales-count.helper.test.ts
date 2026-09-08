/**
 * sales-count helper 单测（批A 销量真实统计 2026-09-07）
 *
 * 覆盖：
 *   - incrementSalesCountForOrder：多行同 productId 聚合（含 quantity>1）+ 审计写入
 *   - incrementSalesCountForOrder：不同 productId 各一条 UPDATE + 审计
 *   - rollbackSalesCountForRefundItems：skuId → Sku.productId 映射 + 负 delta + REFUND 审计
 *   - 回滚守卫：salesCount < 扣减量 → 0 行返回 → 跳过 + 不写审计 + logger.warn
 *   - 回滚边界：恰好减到 0 不越界（afterQty=0）
 *   - rollbackSalesCountForRefundItems：skuId 无对应 SKU → warn + 跳过该行，其余继续
 *   - rollbackSalesCountForFullOrder：remaining = quantity − 已 COMPLETED 退款量，只减剩余
 *   - rollbackSalesCountForFullOrder：已全量退过的 orderItem 不再减
 *
 * mock：纯 fake tx（$queryRaw / orderItem / sku / refundItem / salesCountLog），
 *       审计断言基于 $queryRaw RETURNING 的 afterQty 倒推 beforeQty
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Tx } from '../src/shared/db';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../src/shared/logger/logger', () => ({ logger: mockLogger }));

import {
  incrementSalesCountForOrder,
  rollbackSalesCountForRefundItems,
  rollbackSalesCountForFullOrder,
  adjustSalesCountForAdmin,
} from '../src/shared/db/sales-count';

/** 构造 fake tx（salesCount helper 依赖的最小面） */
function makeTx(opts: { queryRawResult?: Array<{ sales_count: number }> } = {}) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(opts.queryRawResult ?? [{ sales_count: 5 }]),
    product: { findUnique: vi.fn().mockResolvedValue(null) },
    orderItem: { findMany: vi.fn().mockResolvedValue([]) },
    sku: { findMany: vi.fn().mockResolvedValue([]) },
    refundItem: { findMany: vi.fn().mockResolvedValue([]) },
    salesCountLog: { create: vi.fn().mockResolvedValue({}) },
  } as unknown as Tx & {
    $queryRaw: ReturnType<typeof vi.fn>;
    product: { findUnique: ReturnType<typeof vi.fn> };
    orderItem: { findMany: ReturnType<typeof vi.fn> };
    sku: { findMany: ReturnType<typeof vi.fn> };
    refundItem: { findMany: ReturnType<typeof vi.fn> };
    salesCountLog: { create: ReturnType<typeof vi.fn> };
  };
}

describe('incrementSalesCountForOrder - 支付成功累加', () => {
  beforeEach(() => {
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
  });

  it('多行同 productId 聚合（含 quantity>1）→ 单条 UPDATE + 单条审计', async () => {
    const tx = makeTx();
    tx.orderItem.findMany.mockResolvedValue([
      { productId: 'p1', quantity: 2 },
      { productId: 'p1', quantity: 1 }, // 同商品多 SKU 行
      { productId: 'p2', quantity: 3 },
    ]);

    await incrementSalesCountForOrder(tx, 'order-1', { operatorId: 'user-1' });

    // p1 聚合 3、p2 聚合 3 → 两条 UPDATE（Map 插入序：p1 先）
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    // tagged template 调用参数：[strings, delta, productId]
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(3);
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p1');
    expect(tx.$queryRaw.mock.calls[1]![1]).toBe(3);
    expect(tx.$queryRaw.mock.calls[1]![2]).toBe('p2');

    // 审计：RETURNING sales_count=5 → after=5，before=5-3=2
    expect(tx.salesCountLog.create).toHaveBeenCalledTimes(2);
    expect(tx.salesCountLog.create.mock.calls[0]![0]).toEqual({
      data: {
        productId: 'p1',
        orderId: 'order-1',
        changeType: 'ORDER',
        changeQty: 3,
        beforeQty: 2,
        afterQty: 5,
        operatorId: 'user-1',
      },
    });
  });

  it('operatorId 缺省（系统动作/回调）→ 审计 operatorId=null', async () => {
    const tx = makeTx();
    tx.orderItem.findMany.mockResolvedValue([{ productId: 'p1', quantity: 1 }]);

    await incrementSalesCountForOrder(tx, 'order-1');

    expect(tx.salesCountLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operatorId: null, changeType: 'ORDER' }),
      }),
    );
  });
});

describe('rollbackSalesCountForRefundItems - 部分退款回滚', () => {
  beforeEach(() => {
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
  });

  it('skuId → Sku.productId 映射 + 负 delta + REFUND 审计', async () => {
    const tx = makeTx();
    tx.sku.findMany.mockResolvedValue([
      { id: 'sku-1', productId: 'p1' },
      { id: 'sku-2', productId: 'p2' },
    ]);

    await rollbackSalesCountForRefundItems(
      tx,
      'order-1',
      [
        { skuId: 'sku-1', refundQty: 2 },
        { skuId: 'sku-2', refundQty: 1 },
      ],
      { operatorId: 'admin-1' },
    );

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    // 回滚 delta 为负：sales_count + (-2)
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(-2);
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p1');
    expect(tx.salesCountLog.create.mock.calls[0]![0]).toEqual({
      data: {
        productId: 'p1',
        orderId: 'order-1',
        changeType: 'REFUND',
        changeQty: -2,
        beforeQty: 7, // after 5 − delta(−2)
        afterQty: 5,
        operatorId: 'admin-1',
      },
    });
  });

  it('守卫拒绝（salesCount < refundQty → RETURNING 0 行）→ 跳过 + 不写审计 + warn', async () => {
    const tx = makeTx({ queryRawResult: [] });
    tx.sku.findMany.mockResolvedValue([{ id: 'sku-1', productId: 'p1' }]);

    await rollbackSalesCountForRefundItems(tx, 'order-1', [{ skuId: 'sku-1', refundQty: 10 }]);

    expect(tx.salesCountLog.create).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'SALES_COUNT_CHANGE_SKIPPED', productId: 'p1', delta: -10 }),
    );
  });

  it('恰好减到 0 不越界（RETURNING afterQty=0）→ 审计 afterQty=0', async () => {
    const tx = makeTx({ queryRawResult: [{ sales_count: 0 }] });
    tx.sku.findMany.mockResolvedValue([{ id: 'sku-1', productId: 'p1' }]);

    await rollbackSalesCountForRefundItems(tx, 'order-1', [{ skuId: 'sku-1', refundQty: 2 }]);

    expect(tx.salesCountLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ changeQty: -2, beforeQty: 2, afterQty: 0 }),
      }),
    );
  });

  it('skuId 无对应 SKU（快照悬空）→ warn + 跳过该行，其余行继续', async () => {
    const tx = makeTx();
    // sku-1 悬空（Sku 已不存在），sku-2 正常
    tx.sku.findMany.mockResolvedValue([{ id: 'sku-2', productId: 'p2' }]);

    await rollbackSalesCountForRefundItems(tx, 'order-1', [
      { skuId: 'sku-1', refundQty: 1 },
      { skuId: 'sku-2', refundQty: 2 },
    ]);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'SALES_COUNT_ROLLBACK_SKU_NOT_FOUND', skuId: 'sku-1' }),
    );
    // 只有 sku-2 那行触发了 UPDATE
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p2');
  });
});

describe('rollbackSalesCountForFullOrder - 整单退款回滚', () => {
  beforeEach(() => {
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
  });

  it('remaining = quantity − 已 COMPLETED 退款量，只减剩余', async () => {
    const tx = makeTx();
    tx.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', productId: 'p1', quantity: 5 },
      { id: 'oi-2', productId: 'p2', quantity: 4 },
    ]);
    // oi-1 之前部分退过 2 → 剩 3；oi-2 没退过 → 剩 4
    tx.refundItem.findMany.mockResolvedValue([
      { orderItemId: 'oi-1', refundQty: 2 },
    ]);

    await rollbackSalesCountForFullOrder(tx, 'order-1', { operatorId: 'admin-1' });

    expect(tx.refundItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          orderItemId: { in: ['oi-1', 'oi-2'] },
          refund: { orderId: 'order-1', status: 'COMPLETED' },
        }),
      }),
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(-3); // p1 剩余 3
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p1');
    expect(tx.$queryRaw.mock.calls[1]![1]).toBe(-4); // p2 剩余 4
  });

  it('已全量退过的 orderItem（remaining=0）→ 不触发 UPDATE', async () => {
    const tx = makeTx();
    tx.orderItem.findMany.mockResolvedValue([
      { id: 'oi-1', productId: 'p1', quantity: 3 },
      { id: 'oi-2', productId: 'p2', quantity: 2 },
    ]);
    tx.refundItem.findMany.mockResolvedValue([{ orderItemId: 'oi-1', refundQty: 3 }]);

    await rollbackSalesCountForFullOrder(tx, 'order-1');

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p2');
  });
});

describe('adjustSalesCountForAdmin - 批C 管理端批量设值', () => {
  beforeEach(() => {
    Object.values(mockLogger).forEach((fn) => fn.mockReset());
  });

  it('设值增大：current 10 → target 15，delta=5 + ADMIN_ADJUST 审计（orderId=null）', async () => {
    const tx = makeTx({ queryRawResult: [{ sales_count: 15 }] });
    tx.product.findUnique.mockResolvedValue({ salesCount: 10 });

    const res = await adjustSalesCountForAdmin(
      tx,
      [{ productId: 'p1', salesCount: 15 }],
      { operatorId: 'admin-1' },
    );

    expect(res).toEqual({ adjusted: ['p1'], skipped: [] });
    // tagged template 参数：[strings, delta, productId]
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(5);
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p1');
    expect(tx.salesCountLog.create.mock.calls[0]![0]).toEqual({
      data: {
        productId: 'p1',
        orderId: null,
        changeType: 'ADMIN_ADJUST',
        changeQty: 5,
        beforeQty: 10,
        afterQty: 15,
        operatorId: 'admin-1',
      },
    });
  });

  it('设值减小：delta 负向（走守卫模板），审计 changeQty=-6 / before 10 / after 4', async () => {
    const tx = makeTx({ queryRawResult: [{ sales_count: 4 }] });
    tx.product.findUnique.mockResolvedValue({ salesCount: 10 });

    await adjustSalesCountForAdmin(tx, [{ productId: 'p1', salesCount: 4 }]);

    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(-6);
    expect(tx.salesCountLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: 'ADMIN_ADJUST',
          changeQty: -6,
          beforeQty: 10,
          afterQty: 4,
        }),
      }),
    );
  });

  it('目标值=当前值（delta=0）→ 不 UPDATE 不写审计，计 adjusted（确认语义）', async () => {
    const tx = makeTx();
    tx.product.findUnique.mockResolvedValue({ salesCount: 10 });

    const res = await adjustSalesCountForAdmin(tx, [{ productId: 'p1', salesCount: 10 }]);

    expect(res).toEqual({ adjusted: ['p1'], skipped: [] });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.salesCountLog.create).not.toHaveBeenCalled();
  });

  it('商品不存在 → skipped + 不触发 UPDATE，同批其余继续', async () => {
    const tx = makeTx({ queryRawResult: [{ sales_count: 20 }] });
    // p0 不存在；p1 current 10
    tx.product.findUnique.mockImplementation(({ where }: any) =>
      Promise.resolve(where.id === 'p1' ? { salesCount: 10 } : null),
    );

    const res = await adjustSalesCountForAdmin(tx, [
      { productId: 'p0', salesCount: 5 },
      { productId: 'p1', salesCount: 20 },
    ]);

    expect(res).toEqual({ adjusted: ['p1'], skipped: ['p0'] });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // 只有 p1
    expect(tx.$queryRaw.mock.calls[0]![2]).toBe('p1');
  });

  it('operatorId 缺省 → 审计 operatorId=null', async () => {
    const tx = makeTx({ queryRawResult: [{ sales_count: 7 }] });
    tx.product.findUnique.mockResolvedValue({ salesCount: 3 });

    await adjustSalesCountForAdmin(tx, [{ productId: 'p1', salesCount: 7 }]);

    expect(tx.salesCountLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operatorId: null, changeType: 'ADMIN_ADJUST' }),
      }),
    );
  });
});
