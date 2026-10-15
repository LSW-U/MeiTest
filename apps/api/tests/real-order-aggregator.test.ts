/**
 * RealOrderAggregator 单测（P0-1，A2.1 聚合口径）
 *
 * 覆盖：
 *   1. MERCHANT：grossAmount = Σ OrderItem.subtotal（order_items 实算）、
 *      orderCount、refundAmount = COMPLETED 退款合计、commission = 8% floor
 *   2. MERCHANT：PENDING_PAYMENT / CANCELLED 订单不计入
 *   3. RIDER：grossAmount = Σ order.deliveryFee（Q2 拍板配送费收入）、
 *      commission = 0、refundAmount = 0、按 taskType=delivery + DELIVERED 过滤
 *   4. RIDER：关联订单 CANCELLED 不计入（R12 互斥口径）
 *   5. 窗口：periodDate 换算 Asia/Dili 当日窗口（UTC+9）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/shared/db', () => ({
  db: {
    order: { findMany: vi.fn() },
    refund: { aggregate: vi.fn() },
    deliveryTask: { findMany: vi.fn() },
    settlement: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));

import { RealOrderAggregator, applyRefundSettlementAdjustment } from '../src/modules/settle/real-order-aggregator.service';
import { db } from '../src/shared/db';

const orderFindMany = db.order.findMany as ReturnType<typeof vi.fn>;
const refundAggregate = db.refund.aggregate as ReturnType<typeof vi.fn>;
const taskFindMany = db.deliveryTask.findMany as ReturnType<typeof vi.fn>;
const settlementUpdateMany = db.settlement.updateMany as ReturnType<typeof vi.fn>;
const settlementUpdate = db.settlement.update as ReturnType<typeof vi.fn>;
const settlementCreate = db.settlement.create as ReturnType<typeof vi.fn>;
const executeRaw = db.$executeRaw as ReturnType<typeof vi.fn>;

describe('RealOrderAggregator', () => {
  let agg: RealOrderAggregator;

  beforeEach(() => {
    vi.clearAllMocks();
    agg = new RealOrderAggregator();
  });

  describe('MERCHANT', () => {
    it('grossAmount = Σ 订单明细 subtotal + commission 8% floor + COMPLETED 退款冲减', async () => {
      // 2 单：明细 subtotal 1000+2000 / 3000 → gross 6000
      orderFindMany.mockResolvedValue([
        { id: 'o1', items: [{ subtotal: 1000 }, { subtotal: 2000 }] },
        { id: 'o2', items: [{ subtotal: 3000 }] },
      ]);
      refundAggregate.mockResolvedValue({ _sum: { amount: 500 } });

      const r = await agg.aggregate(new Date('2026-10-10'), 'MERCHANT', 'shop-1');

      expect(r.orderCount).toBe(2);
      expect(r.grossAmount).toBe(6000);
      expect(r.refundAmount).toBe(500);
      // (6000-500) × 0.08 = 440
      expect(r.commission).toBe(440);
    });

    it('commission 向下取整（(gross-refund)×0.08 非整）', async () => {
      orderFindMany.mockResolvedValue([{ id: 'o1', items: [{ subtotal: 1234 }] }]);
      refundAggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const r = await agg.aggregate(new Date('2026-10-10'), 'MERCHANT', 'shop-1');
      // 1234 × 0.08 = 98.72 → 98
      expect(r.commission).toBe(98);
    });

    it('查询过滤：只查计入状态 + warehouse.shopId 归属 + 退款只查 COMPLETED', async () => {
      orderFindMany.mockResolvedValue([]);
      refundAggregate.mockResolvedValue({ _sum: { amount: null } });

      await agg.aggregate(new Date('2026-10-10'), 'MERCHANT', 'shop-1');

      expect(orderFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            warehouse: { shopId: 'shop-1' },
            // PENDING_PAYMENT / CANCELLED 排除
            status: { in: expect.arrayContaining(['CONFIRMED', 'COMPLETED', 'DELIVERED_PAID']) },
          }),
        }),
      );
      const where = orderFindMany.mock.calls[0][0].where;
      expect(where.status.in).not.toContain('PENDING_PAYMENT');
      expect(where.status.in).not.toContain('CANCELLED');
      expect(refundAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
    });

    it('零订单 → 全 0', async () => {
      orderFindMany.mockResolvedValue([]);
      refundAggregate.mockResolvedValue({ _sum: { amount: null } });

      const r = await agg.aggregate(new Date('2026-10-10'), 'MERCHANT', 'shop-1');
      expect(r).toEqual({ orderCount: 0, grossAmount: 0, refundAmount: 0, commission: 0 });
    });
  });

  describe('RIDER', () => {
    it('grossAmount = Σ order.deliveryFee + commission/refund 恒 0（Q2 拍板配送费收入）', async () => {
      taskFindMany.mockResolvedValue([
        { order: { deliveryFee: 500 } },
        { order: { deliveryFee: 700 } },
      ]);

      const r = await agg.aggregate(new Date('2026-10-10'), 'RIDER', 'rider-profile-1');

      expect(r.orderCount).toBe(2);
      expect(r.grossAmount).toBe(1200);
      expect(r.refundAmount).toBe(0);
      expect(r.commission).toBe(0);
    });

    it('查询过滤：taskType=delivery + DELIVERED + riderId + 订单未 CANCELLED + deliveredAt 窗口', async () => {
      taskFindMany.mockResolvedValue([]);

      await agg.aggregate(new Date('2026-10-10'), 'RIDER', 'rider-profile-1');

      expect(taskFindMany).toHaveBeenCalledWith({
        where: {
          riderId: 'rider-profile-1',
          taskType: 'delivery',
          status: 'DELIVERED',
          deliveredAt: { gte: expect.any(Date), lt: expect.any(Date) },
          // P27 批B1：软删订单不计入骑手配送费聚合
          order: { status: { not: 'CANCELLED' }, deletedAt: null },
        },
        select: { order: { select: { deliveryFee: true } } },
      });
    });

    it('零任务 → 全 0', async () => {
      taskFindMany.mockResolvedValue([]);

      const r = await agg.aggregate(new Date('2026-10-10'), 'RIDER', 'rider-profile-1');
      expect(r).toEqual({ orderCount: 0, grossAmount: 0, refundAmount: 0, commission: 0 });
    });
  });

  describe('时间窗口（A2.1 Dili UTC+9）', () => {
    it('periodDate 换算为 Dili 当日 [00:00+09:00, +24h) 窗口', async () => {
      orderFindMany.mockResolvedValue([]);
      refundAggregate.mockResolvedValue({ _sum: { amount: null } });

      // new Date('2026-10-10') = UTC 零点；Dili 当日 0 点 = UTC 前一天 15:00
      await agg.aggregate(new Date('2026-10-10'), 'MERCHANT', 'shop-1');

      const where = orderFindMany.mock.calls[0][0].where;
      expect(where.createdAt.gte.toISOString()).toBe('2026-10-09T15:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-10-10T15:00:00.000Z');
    });
  });
});

/**
 * D8（方案v3 20261012，A2.9a/b）：applyRefundSettlementAdjustment 单测
 * 退款负向调整 Settlement —— 归属期按退款 completedAt（Dili 当期）、
 * 不改写历史行、commission clamp ≥ 0、进 Σ netAmount 派生链。
 */
describe('applyRefundSettlementAdjustment（D8 / A2.9a+b）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('A2.9b 跨期退款：当期行不存在 → 新建负向调整行（netAmount=−refund，历史行零触碰）', async () => {
    // 当期行不存在：updateMany count=0，create 成功
    settlementUpdateMany.mockResolvedValue({ count: 0 });
    settlementCreate.mockResolvedValue({});

    await applyRefundSettlementAdjustment(
      db,
      10000,
      new Date('2026-10-12T02:00:00.000Z'), // Dili 2026-10-12 11:00
      'shop-1',
    );

    // 归属期 = 退款时间的 Dili 当期（2026-10-12）
    expect(settlementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          periodDate: new Date('2026-10-12T00:00:00.000Z'),
          subjectType: 'MERCHANT',
          subjectId: 'shop-1',
          orderCount: 0,
          grossAmount: 0,
          commission: 0, // clamp ≥ 0：无正收入可冲，抽成 0
          refundAmount: 10000,
          netAmount: -10000,
          status: 'PENDING',
        }),
      }),
    );
    // 未 update 任何历史行
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('当期 PENDING 行已存在 → 单语句冲减（P2-1 LEAST clamp 收口：updateMany 只 increment refund + $executeRaw commission/netAmount）', async () => {
    settlementUpdateMany.mockResolvedValue({ count: 1 });
    executeRaw.mockResolvedValue(1);

    await applyRefundSettlementAdjustment(
      db,
      5000,
      new Date('2026-10-12T02:00:00.000Z'),
      'shop-1',
    );

    // P2-2：where 限定 status='PENDING'（已确认行不可冲减）
    expect(settlementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          periodDate: new Date('2026-10-12T00:00:00.000Z'),
          subjectType: 'MERCHANT',
          subjectId: 'shop-1',
          status: 'PENDING',
        },
        data: { refundAmount: { increment: 5000 } },
      }),
    );
    // P2-1：commission clamp + netAmount 调整收进同一条 raw SQL（LEAST 一步钳到 ≥0）
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const sql = executeRaw.mock.calls[0][0] as TemplateStringsArray;
    const sqlText = Array.isArray(sql) ? sql.join('?') : String(sql);
    expect(sqlText).toContain('GREATEST(0, "commission"');
    expect(sqlText).toContain('status');
    // 不再有两步回读校正
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('A2.9a 全额退款 clamp（P2-1 收口后）：GREATEST 保证 commission ≥ 0，无独立校正语句', async () => {
    settlementUpdateMany.mockResolvedValue({ count: 1 });
    executeRaw.mockResolvedValue(1);

    // 大额退款：delta 4000 > 当期 commission（mock 不关心行内值，GREATEST 在 DB 端钳制）
    await applyRefundSettlementAdjustment(
      db,
      50000,
      new Date('2026-10-12T02:00:00.000Z'),
      'shop-1',
    );

    // clamp 全在单条 raw SQL 内（GREATEST(0, commission − delta)），不再走 findUnique 回读 + update 校正
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('P3-1 当期行已 CONFIRMED → 降级 append 负向调整行（updateMany 命中 0 行，历史行零改写）', async () => {
    // 目标期行存在但已确认：updateMany where status='PENDING' 命中 0
    settlementUpdateMany.mockResolvedValue({ count: 0 });
    settlementCreate.mockResolvedValue({});

    await applyRefundSettlementAdjustment(
      db,
      10000,
      new Date('2026-10-12T02:00:00.000Z'),
      'shop-1',
    );

    // 不冲减已确认行（updateMany/count=0 后无 $executeRaw）
    expect(executeRaw).not.toHaveBeenCalled();
    // 降级 append 负向调整行（PENDING，netAmount=−refund）
    expect(settlementCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          periodDate: new Date('2026-10-12T00:00:00.000Z'),
          subjectType: 'MERCHANT',
          subjectId: 'shop-1',
          orderCount: 0,
          grossAmount: 0,
          commission: 0,
          refundAmount: 10000,
          netAmount: -10000,
          status: 'PENDING',
        }),
      }),
    );
    expect(settlementUpdate).not.toHaveBeenCalled();
  });

  it('当期行创建竞态 P2002 → 回查 PENDING → 降级走冲减路径（重入成功即返回）', async () => {
    settlementUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // 首次：当期行不存在
      .mockResolvedValueOnce({ count: 1 }); // 降级重入：行已存在且 PENDING → 冲减成功
    settlementCreate.mockRejectedValue({ code: 'P2002' });
    // P2002 后回查：竞态对方刚建的行是 PENDING → 走冲减降级
    (db.settlement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'row-race',
      status: 'PENDING',
    });
    executeRaw.mockResolvedValue(1);

    await applyRefundSettlementAdjustment(
      db,
      1000,
      new Date('2026-10-12T02:00:00.000Z'),
      'shop-1',
    );

    expect(settlementCreate).toHaveBeenCalledTimes(1);
    // 降级路径冲减成功（updateMany 第二次调用）
    expect(settlementUpdateMany).toHaveBeenCalledTimes(2);
  });

  it('P3-1 附加：append 撞 P2002 且回查非 PENDING（已确认行占唯一键）→ fail-closed E-SETTLE-005', async () => {
    settlementUpdateMany.mockResolvedValue({ count: 0 }); // 目标期已确认（非 PENDING 命中 0）
    settlementCreate.mockRejectedValue({ code: 'P2002' }); // append 撞唯一键
    (db.settlement.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'row-confirmed',
      status: 'CONFIRMED',
    });

    await expect(
      applyRefundSettlementAdjustment(db, 1000, new Date('2026-10-12T02:00:00.000Z'), 'shop-1'),
    ).rejects.toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'E-SETTLE-005' }) }));
  });
});
