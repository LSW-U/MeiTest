/**
 * 对账台账单测（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3 / 任务书 单测 ≥4）
 *
 * 覆盖：
 *   1. COD 写台账（PAID/SHORT/UNPAID 三态 create 数据形状；dispatch deliverTask 钩子共用 writer）
 *   2. BANK_TRANSFER 写台账（cashResult=null + 纯 USD 资金流 exchangeRate/amountCny=null）
 *   3. 幂等：orderId 已有台账行 → 跳过 create（同单多事件只写一行）
 *   4. 写失败不阻断：create 抛错 → 函数 resolve 不上抛（主流程容忍，与 @Audit/ImportLog 同策略）
 *   5. 筛选查询：listLedgers method/status/orderNo/日期区间 → where 形状 + offset 分页（ImportLog 模式）
 *   6. 分区汇总：getSummary groupBy method+cashResult + totalAmountCny null→0 收敛（admin 三区数据源）
 *   7. 导入批次列表：listBatches 按格式筛选（预留入口）
 *
 * mock：db（reconciliationLedger/statementImportBatch，供读侧 service）；
 *       writer 直测 fake tx 对象（不走 barrel mock，直 import 文件路径）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    reconciliationLedger: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    statementImportBatch: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('../src/shared/db', () => ({ db: mockDb }));

import { writeReconciliationLedgerTx } from '../src/shared/db/reconciliation-ledger';
import { ReconciliationService } from '../src/modules/reconciliation/reconciliation.service';
import type { Tx } from '../src/shared/db/transaction';

/** fake tx：只挂 reconciliationLedger（writer 唯一触达的表），其他误用会抛错暴露 */
function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    reconciliationLedger: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'rl-1' }),
    },
    ...overrides,
  } as unknown as Tx;
}

describe('writeReconciliationLedgerTx（写入钩子共用 writer）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('COD PAID：写一行 PENDING 台账（amountUsd=实收，纯 USD 两字段 null）', async () => {
    const tx = makeTx();

    await writeReconciliationLedgerTx(tx, {
      orderId: 'order-1',
      orderNo: 'MM2026090801000001',
      paymentMethod: 'COD',
      amountUsd: 1250,
      cashResult: 'PAID',
    });

    // 幂等守卫先查（orderId 锚点）
    expect(tx.reconciliationLedger.findUnique).toHaveBeenCalledWith({
      where: { orderId: 'order-1' },
      select: { id: true },
    });
    expect(tx.reconciliationLedger.create).toHaveBeenCalledTimes(1);
    expect(tx.reconciliationLedger.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        orderNo: 'MM2026090801000001',
        paymentMethod: 'COD',
        amountUsd: 1250,
        exchangeRate: null,
        amountCny: null,
        cashResult: 'PAID',
        status: 'PENDING',
      },
      select: { id: true },
    });
  });

  it('COD UNPAID 拒付：amountUsd=0 + cashResult=UNPAID（T3 未支付口径入台账）', async () => {
    const tx = makeTx();

    await writeReconciliationLedgerTx(tx, {
      orderId: 'order-2',
      orderNo: 'MM2026090801000002',
      paymentMethod: 'COD',
      amountUsd: 0,
      cashResult: 'UNPAID',
    });

    expect(tx.reconciliationLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentMethod: 'COD',
        amountUsd: 0,
        cashResult: 'UNPAID',
        status: 'PENDING',
      }),
      select: { id: true },
    });
  });

  it('BANK_TRANSFER 审核通过：cashResult=null（非 COD），amountUsd=PaymentIntent.amount', async () => {
    const tx = makeTx();

    await writeReconciliationLedgerTx(tx, {
      orderId: 'order-3',
      orderNo: 'MM2026090801000003',
      paymentMethod: 'BANK_TRANSFER',
      amountUsd: 5800,
      cashResult: null,
    });

    expect(tx.reconciliationLedger.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-3',
        orderNo: 'MM2026090801000003',
        paymentMethod: 'BANK_TRANSFER',
        amountUsd: 5800,
        exchangeRate: null,
        amountCny: null,
        cashResult: null,
        status: 'PENDING',
      },
      select: { id: true },
    });
  });

  it('幂等：同单已有台账行 → 跳过 create（同单多事件只写一行）', async () => {
    const tx = makeTx({
      reconciliationLedger: {
        findUnique: vi.fn().mockResolvedValue({ id: 'rl-existing' }),
        create: vi.fn().mockResolvedValue({ id: 'rl-2' }),
      },
    });

    await writeReconciliationLedgerTx(tx, {
      orderId: 'order-1',
      orderNo: 'MM2026090801000001',
      paymentMethod: 'COD',
      amountUsd: 1250,
      cashResult: 'PAID',
    });

    expect(tx.reconciliationLedger.findUnique).toHaveBeenCalledTimes(1);
    expect(tx.reconciliationLedger.create).not.toHaveBeenCalled();
  });

  it('写失败不阻断：create 抛错 → 函数 resolve 不上抛（送达/审核主流程容忍策略）', async () => {
    const tx = makeTx({
      reconciliationLedger: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('db connection lost')),
      },
    });

    await expect(
      writeReconciliationLedgerTx(tx, {
        orderId: 'order-4',
        orderNo: 'MM2026090801000004',
        paymentMethod: 'COD',
        amountUsd: 900,
        cashResult: 'SHORT',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('ReconciliationService（读侧：列表筛选 / 分区汇总 / 批次列表）', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReconciliationService();
  });

  it('listLedgers：method/status/orderNo/日期区间 → where 形状 + offset 分页 + createdAt ISO 化', async () => {
    mockDb.reconciliationLedger.findMany.mockResolvedValue([
      {
        id: 'rl-1',
        orderId: 'order-1',
        orderNo: 'MM2026090801000001',
        paymentMethod: 'COD',
        amountUsd: 1250,
        exchangeRate: null,
        amountCny: null,
        cashResult: 'PAID',
        status: 'PENDING',
        statementBatchId: null,
        createdAt: new Date('2026-09-08T01:00:00.000Z'),
      },
    ]);
    mockDb.reconciliationLedger.count.mockResolvedValue(11);

    const result = await service.listLedgers({
      method: 'COD',
      status: 'PENDING',
      orderNo: 'MM2026',
      dateFrom: '2026-09-01T00:00:00.000Z',
      dateTo: '2026-09-08T00:00:00.000Z',
      page: 2,
      pageSize: 10,
    });

    const expectedWhere = {
      paymentMethod: 'COD',
      status: 'PENDING',
      orderNo: { contains: 'MM2026', mode: 'insensitive' },
      createdAt: {
        gte: new Date('2026-09-01T00:00:00.000Z'),
        lt: new Date('2026-09-08T00:00:00.000Z'),
      },
    };
    expect(mockDb.reconciliationLedger.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
    });
    expect(mockDb.reconciliationLedger.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'rl-1',
          method: 'COD',
          createdAt: '2026-09-08T01:00:00.000Z',
        }),
      ],
      page: 2,
      pageSize: 10,
      total: 11,
    });
  });

  it('getSummary：group by method+cashResult，totalAmountCny 全 null 组收敛为 0（admin 三区数据源）', async () => {
    mockDb.reconciliationLedger.groupBy.mockResolvedValue([
      {
        paymentMethod: 'COD',
        cashResult: 'PAID',
        _count: { _all: 3 },
        _sum: { amountUsd: 3750, amountCny: null },
      },
      {
        paymentMethod: 'BANK_TRANSFER',
        cashResult: null,
        _count: { _all: 1 },
        _sum: { amountUsd: 5800, amountCny: null },
      },
    ]);

    const result = await service.getSummary();

    expect(mockDb.reconciliationLedger.groupBy).toHaveBeenCalledWith({
      by: ['paymentMethod', 'cashResult'],
      _count: { _all: true },
      _sum: { amountUsd: true, amountCny: true },
    });
    expect(result.items).toEqual([
      { method: 'COD', cashResult: 'PAID', count: 3, totalAmountUsd: 3750, totalAmountCny: 0 },
      {
        method: 'BANK_TRANSFER',
        cashResult: null,
        count: 1,
        totalAmountUsd: 5800,
        totalAmountCny: 0,
      },
    ]);
  });

  it('listBatches：按 format 筛选（预留入口）', async () => {
    mockDb.statementImportBatch.findMany.mockResolvedValue([
      {
        id: 'sib-1',
        fileName: 'wechat_bill_202609.csv',
        format: 'WECHAT',
        rowCount: 100,
        successCount: 98,
        failedCount: 2,
        status: 'PARTIAL',
        operatorId: 'admin-1',
        createdAt: new Date('2026-09-08T02:00:00.000Z'),
      },
    ]);
    mockDb.statementImportBatch.count.mockResolvedValue(1);

    const result = await service.listBatches({ format: 'WECHAT', page: 1, pageSize: 20 });

    expect(mockDb.statementImportBatch.findMany).toHaveBeenCalledWith({
      where: { format: 'WECHAT' },
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 20,
    });
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'sib-1',
        format: 'WECHAT',
        createdAt: '2026-09-08T02:00:00.000Z',
      }),
    );
    expect(result.total).toBe(1);
  });
});
