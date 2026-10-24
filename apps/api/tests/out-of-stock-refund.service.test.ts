/**
 * OutOfStockRefundService 单测（缺货履约闭环批3 2026-10-24，D9b/D13/D15/D17）
 *
 * 三场景（任务书 A3 中两场景单测层 + 通路内部行为）：
 *   - 场景2 D13 合并账：同单进行中 OUT_OF_STOCK system 退款 → 追加 RefundItem 重算 amount
 *   - 场景3 D17 超上限：单笔金额 > autoRefundMaxAmount → 落 PENDING 转人工（mode=pending）
 *   - 直退 happy path：金额 ≤ 上限 → completeSystemRefundTx（COMPLETED + reviewedBy='SYSTEM'）
 *   - 规则关：autoRefundFullShortage=false → triggered=false
 *   - D14 COMPLETED 后二次缺货：无进行中退款 → 新建第二笔
 *
 * mock：db + withTransaction 透传（out-of-stock.service.test.ts 同款范式）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    order: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    outOfStockRule: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    paymentIntent: { findUnique: vi.fn() },
    refund: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    refundItem: { create: vi.fn(), aggregate: vi.fn() },
    cashCollection: { findFirst: vi.fn() },
    systemConfig: { upsert: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../src/shared/db', () => ({
  db: mockDb,
  withTransaction: (fn: (tx: unknown) => Promise<unknown>) => fn(mockDb),
  rollbackSalesCountForRefundItems: vi.fn().mockResolvedValue(undefined),
  rollbackSalesCountForFullOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/modules/settle/real-order-aggregator.service', () => ({
  applyRefundSettlementAdjustment: vi.fn().mockResolvedValue(undefined),
}));

import { OutOfStockRefundService, DEFAULT_OOS_RULE } from '../src/modules/order/out-of-stock-refund.service';
import { rollbackSalesCountForRefundItems } from '../src/shared/db';
import { applyRefundSettlementAdjustment } from '../src/modules/settle/real-order-aggregator.service';

function buildCandidate(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'order-1',
    items: [
      { orderItemId: 'item-1', skuId: 'sku-1', productName: { en: 'Milk' }, unitPrice: 1000, refundQty: 1 },
    ],
    fullShortage: true,
    warehouseId: 'wh-1',
    ...overrides,
  };
}

function buildOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'u1',
    payableAmount: 10000,
    paymentStatus: 'PAID',
    paymentMethod: 'STRIPE',
    warehouseId: 'wh-1',
    warehouse: { shopId: 'shop-1' },
    items: [{ skuId: 'sku-1', quantity: 1 }],
    ...overrides,
  };
}

function buildRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 'refund-1',
    orderId: 'order-1',
    userId: 'u1',
    amount: 1000,
    reason: 'OUT_OF_STOCK',
    status: 'PENDING',
    reviewedBy: null,
    refundMethod: 'STRIPE',
    items: [
      { id: 'ri-1', refundId: 'refund-1', orderItemId: 'item-1', skuId: 'sku-1', productName: { en: 'Milk' }, unitPrice: 1000, refundQty: 1, subtotal: 1000 },
    ],
    ...overrides,
  };
}

describe('OutOfStockRefundService（批3 D9b system 通路）', () => {
  let service: OutOfStockRefundService;

  beforeEach(() => {
    vi.clearAllMocks();
    // 规则默认（全缺开 / 上限 5000）
    mockDb.outOfStockRule.findFirst.mockResolvedValue(null);
    mockDb.paymentIntent.findUnique.mockResolvedValue(null); // → COD
    mockDb.order.findUnique.mockResolvedValue(buildOrder());
    mockDb.order.findUniqueOrThrow.mockResolvedValue(buildOrder());
    // 无进行中退款 → 新建
    mockDb.refund.findFirst.mockResolvedValue(null);
    mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockDb.refund.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve(buildRefund({ ...data, items: undefined })),
    );
    mockDb.refund.findUniqueOrThrow.mockResolvedValue(buildRefund());
    mockDb.refund.findUniqueOrThrow.mockResolvedValue(buildRefund());
    mockDb.refund.updateMany.mockResolvedValue({ count: 1 });
    mockDb.refundItem.aggregate.mockResolvedValue({ _sum: { subtotal: 1000 } });
    mockDb.$executeRaw.mockResolvedValue(0);
    service = new OutOfStockRefundService(null);
  });

  it('直退 happy path：金额 ≤ 上限 → 新建 PENDING → 翻 COMPLETED + reviewedBy=SYSTEM + 销量回滚 + Settlement 调整', async () => {
    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.triggered).toBe(true);
    expect(result.mode).toBe('direct');
    // 条件翻转：WHERE status=PENDING，flip 带 SYSTEM 标记
    expect(mockDb.refund.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING' }),
        data: expect.objectContaining({ status: 'COMPLETED', reviewedBy: 'SYSTEM' }),
      }),
    );
    // 销量回滚（PAID 预付单）+ Settlement 调整被调
    expect(rollbackSalesCountForRefundItems).toHaveBeenCalled();
    expect(applyRefundSettlementAdjustment).toHaveBeenCalled();
  });

  it('场景3 D17 超上限：金额 > autoRefundMaxAmount → 落 PENDING 转人工（mode=pending，不翻 COMPLETED）', async () => {
    // 上限 5000 分，退款 6000 分 → pending
    const result = await service.processOutOfStockRefund(
      buildCandidate({ items: [{ orderItemId: 'item-1', skuId: 'sku-1', productName: { en: 'Milk' }, unitPrice: 3000, refundQty: 2 }] }),
    );

    expect(result.mode).toBe('pending');
    expect(result.triggered).toBe(true);
    // 未触发直退翻转
    expect(mockDb.refund.updateMany).not.toHaveBeenCalled();
    // SYSTEM 来源标记落库（人工 reviewRefund 可见通路来源）
    expect(mockDb.refund.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { reviewedBy: 'SYSTEM' } }),
    );
  });

  it('场景2 D13 合并账：同单进行中 OUT_OF_STOCK system 退款 → 追加 RefundItem + aggregate 重算 amount，不新建', async () => {
    mockDb.refund.findFirst.mockResolvedValue(
      buildRefund({ status: 'PENDING', reviewedBy: 'SYSTEM', items: [
        { id: 'ri-1', refundId: 'refund-1', orderItemId: 'item-old', skuId: 'sku-0', productName: {}, unitPrice: 500, refundQty: 1, subtotal: 500 },
      ] }),
    );
    // 重算：旧 500 + 新 1000 = 1500
    mockDb.refundItem.aggregate.mockResolvedValue({ _sum: { subtotal: 1500 } });

    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.triggered).toBe(true);
    expect(result.refundId).toBe('refund-1');
    expect(result.amount).toBe(1500);
    // 追加行（跳过已入账 item-old）
    expect(mockDb.refundItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ refundId: 'refund-1', orderItemId: 'item-1', subtotal: 1000 }),
    });
    // 不新建退款单
    expect(mockDb.refund.create).not.toHaveBeenCalled();
  });

  it('场景2 D13 合并账零新增（本次项全部已入账）→ 不追加不重算不推送，按原 amount 返回 pending（P3-3）', async () => {
    mockDb.refund.findFirst.mockResolvedValue(
      buildRefund({ status: 'PENDING', reviewedBy: 'SYSTEM', items: [
        { id: 'ri-1', refundId: 'refund-1', orderItemId: 'item-1', skuId: 'sku-1', productName: {}, unitPrice: 1000, refundQty: 1, subtotal: 1000 },
      ] }),
    );

    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.mode).toBe('pending');
    expect(result.amount).toBe(1000);
    expect(mockDb.refundItem.create).not.toHaveBeenCalled();
    // P3-3：零新增不推「退款处理中」——notifyRefundResult 不被调（notificationEvents 未注入
    // 时内部静默，此处用 db.order 查询次数判定：零新增路径不应走到 notify 的 order findUnique）
    const orderReads = mockDb.order.findUnique.mock.calls.length;
    // 引擎开头阈值判定读过一次 payable；零新增路径不应再读（notify 内的读）
    expect(orderReads).toBeLessThanOrEqual(1);
  });

  it('D14 COMPLETED 后二次缺货：无进行中退款 → 新建第二笔（不受整单 COMPLETED 守卫约束，豁免在通路内部）', async () => {
    // aggregate 返回已有第一笔 COMPLETED 退款 1000 分
    mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: 1000 } });
    // payable 10000，再退 1000 不超额 → 直退第二笔
    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.triggered).toBe(true);
    expect(result.mode).toBe('direct');
    expect(mockDb.refund.create).toHaveBeenCalledTimes(1);
  });

  it('防超额兜底：Σ COMPLETED + 本次 > payableAmount → 不建单（OOS_REFUND_EXCEEDS_PAYABLE）', async () => {
    mockDb.refund.aggregate.mockResolvedValue({ _sum: { amount: 9500 } });

    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.triggered).toBe(false);
    expect(result.mode).toBe('none');
    expect(mockDb.refund.create).not.toHaveBeenCalled();
  });

  it('规则关：autoRefundFullShortage=false → 不建单不建行', async () => {
    mockDb.outOfStockRule.findFirst.mockResolvedValue({ ...DEFAULT_OOS_RULE, autoRefundFullShortage: false });

    const result = await service.processOutOfStockRefund(buildCandidate());

    expect(result.triggered).toBe(false);
    expect(mockDb.refund.create).not.toHaveBeenCalled();
  });

  it('部分缺阈值未开（默认）→ 部分缺候选静默不触发', async () => {
    const result = await service.processOutOfStockRefund(buildCandidate({ fullShortage: false }));

    expect(result.triggered).toBe(false);
  });

  it('部分缺阈值开且占比达标 → 触发（ratioBp = 1000/10000 = 1000bp ≥ 1000bp 边界）', async () => {
    mockDb.outOfStockRule.findFirst.mockResolvedValue({
      ...DEFAULT_OOS_RULE,
      partialShortageThresholdEnabled: true,
      partialShortageThresholdBp: 1000,
    });

    const result = await service.processOutOfStockRefund(buildCandidate({ fullShortage: false }));

    expect(result.triggered).toBe(true);
    expect(result.mode).toBe('direct');
  });

  it('并发翻转失败（count=0，他人已翻走）→ E-OOS-008 整体回滚（P3-2 语义修正：非规则禁用）', async () => {
    mockDb.refund.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.processOutOfStockRefund(buildCandidate())).rejects.toMatchObject({
      response: { code: 'E-OOS-008' },
    });
  });

  it('advisory lock 用 (4, hashtext) 键域——与 refund.service (3, hash) 不重叠', async () => {
    await service.processOutOfStockRefund(buildCandidate());

    // $executeRaw 是 tagged template 调用：第一参为 strings 数组（Prisma sql tagged template）
    expect(mockDb.$executeRaw).toHaveBeenCalled();
    const arg0 = (mockDb.$executeRaw.mock.calls[0] as unknown[])[0];
    const sql = typeof arg0 === 'string' ? arg0 : String((arg0 as readonly string[]).join('?'));
    expect(sql).toContain('pg_advisory_xact_lock(4');
  });

  it('直退路径建单时 reviewedBy 为 null（SYSTEM 标记由 flipData 写入，不留中间态）', async () => {
    await service.processOutOfStockRefund(buildCandidate());

    expect(mockDb.refund.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewedBy: null, reason: 'OUT_OF_STOCK', status: 'PENDING' }),
      }),
    );
  });
});
