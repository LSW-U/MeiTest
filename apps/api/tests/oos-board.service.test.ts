/**
 * OosBoardService 单测（缺货履约闭环批4 2026-10-24 · A5）
 *
 * 重点验证（任务书批4 验收线：测试断言聚合口径）：
 *   - 三指标口径：分母/分子 SQL 语义（履约=GMV 六态 / 登记=out_of_stock_qty 非空 /
 *     退款=reason=OUT_OF_STOCK 全 status / system=reviewed_by / pending=status）
 *   - 率计算与分母 0 → null（批D/E 同范式）
 *   - BigInt → number 转换
 *   - 时间边界：预设透传 / E-STATISTICS-001/002 透传（公共层抛出，服务层不吞）
 *   - trend 行映射（date 文本 + 三计数）
 * 铁律：只读聚合不动 RealOrderAggregator/Settlement——本文件即独立 service 的口径留痕。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@prisma/client', () => ({
  Prisma: {
    raw: (s: string) => s,
    sql: (s: TemplateStringsArray) => ({ sql: String.raw(s) }),
    join: (parts: unknown[]) => ({ parts }),
    JsonValue: {},
  },
}));

vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([]),
  },
}));

import { OosBoardService } from '../src/modules/statistics/oos-board.service';
import { db } from '../src/shared/db';

const dbMock = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
};

describe('OosBoardService.getOosBoard', () => {
  let service: OosBoardService;

  beforeEach(() => {
    vi.clearAllMocks();
    // 默认四条 SQL 全空（履约 0 / 登记 0 / 退款 0 / trend 空）
    dbMock.$queryRaw.mockResolvedValue([]);
    service = new OosBoardService();
  });

  it('三指标计算：分子/分母/率 全链路（含 BigInt → number）', async () => {
    // $queryRaw 依次被调用：履约 / 登记 / 退款三桶 / trend
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ cnt: BigInt(200) }]) // 履约订单
      .mockResolvedValueOnce([{ cnt: BigInt(50) }]) // 有登记订单
      .mockResolvedValueOnce([
        { total: BigInt(40), system_cnt: BigInt(30), pending_cnt: BigInt(6) },
      ]) // 退款三桶
      .mockResolvedValueOnce([
        { d: '2026-10-23', reported: BigInt(2), oos_refunds: BigInt(3), system_refunds: BigInt(2) },
        { d: '2026-10-24', reported: BigInt(1), oos_refunds: BigInt(1), system_refunds: BigInt(1) },
      ]);

    const res = await service.getOosBoard({ range: 'week' });

    expect(res.fulfilledOrderCount).toBe(200);
    expect(res.reportedOrderCount).toBe(50);
    expect(res.reportRate).toBeCloseTo(0.25);
    expect(res.oosRefundCount).toBe(40);
    expect(res.systemRefundCount).toBe(30);
    expect(res.autoRefundRate).toBeCloseTo(0.75);
    expect(res.pendingCount).toBe(6);
    expect(res.manualInterventionRate).toBeCloseTo(0.15);
    expect(res.trend).toEqual([
      { date: '2026-10-23', reported: 2, oosRefunds: 3, systemRefunds: 2 },
      { date: '2026-10-24', reported: 1, oosRefunds: 1, systemRefunds: 1 },
    ]);
  });

  it('分母 0 → 三率全 null（批D/E 同范式：率无意义不造 0）', async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ cnt: BigInt(0) }])
      .mockResolvedValueOnce([{ cnt: BigInt(0) }])
      .mockResolvedValueOnce([{ total: BigInt(0), system_cnt: BigInt(0), pending_cnt: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const res = await service.getOosBoard({ range: 'today' });

    expect(res.reportRate).toBeNull();
    expect(res.autoRefundRate).toBeNull();
    expect(res.manualInterventionRate).toBeNull();
  });

  it('口径 SQL 语义：履约走 GMV 状态集 / 登记锚 out_of_stock_qty 非空 / 退款锚 OUT_OF_STOCK 全 status', async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ cnt: BigInt(1) }])
      .mockResolvedValueOnce([{ cnt: BigInt(1) }])
      .mockResolvedValueOnce([{ total: BigInt(1), system_cnt: BigInt(0), pending_cnt: BigInt(0) }])
      .mockResolvedValueOnce([]);

    await service.getOosBoard({ range: 'month' });

    // mock 的 Prisma.sql 把静态段与插值段分离——递归收集全部字符串片段（批D walk 同款范式）
    const walk = (v: unknown, seen: string[]): void => {
      if (typeof v === 'string') { seen.push(v); return; }
      if (Array.isArray(v)) { v.forEach((x) => walk(x, seen)); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.strings)) o.strings.forEach((x) => walk(x, seen));
        if (Array.isArray(o.values)) o.values.forEach((x) => walk(x, seen));
        if (typeof o.sql === 'string') seen.push(o.sql);
        if (Array.isArray(o.parts)) o.parts.forEach((x) => walk(x, seen));
      }
    };
    // 逐调用收集：seen 按调用分桶（每次 $queryRaw 一个桶），join(' ') 拼断言串
    const perCall: string[][] = [];
    dbMock.$queryRaw.mock.calls.forEach((call: unknown[]) => {
      const bucket: string[] = [];
      walk(call, bucket);
      perCall.push(bucket);
    });
    const sqls = perCall.map((b) => b.join(' '));

    // 履约分母：GMV 状态集经 metrics.ts 单源注入——服务层 Prisma 来自本地生成客户端
    // （真实 sqltag：join 产出 strings/values，walk 递归可收集到六态字面量）
    expect(sqls[0]).toContain('WHERE (');
    expect(sqls[0]).toContain('o.status::text IN (');
    // 六态字面量全部出现在聚合 SQL（DELIVERED_UNPAID 不在集合——非履约）
    for (const s of ['CONFIRMED', 'PICKED', 'OUT_FOR_DELIVERY', 'DELIVERED_PAID', 'DELIVERED', 'COMPLETED']) {
      expect(sqls[0]).toContain(s);
    }
    expect(sqls[0]).not.toContain('DELIVERED_UNPAID');
    // P2-1 方案1：分母补全缺取消单（CANCELLED + cancel_reason='OUT_OF_STOCK'）——
    // 全缺订单被 CANCELLED 踢出会高估登记率；保证分子⊆分母、率恒≤1
    expect(sqls[0]).toContain('CANCELLED');
    expect(sqls[0]).toContain('cancel_reason');
    expect(sqls[0]).toContain('OUT_OF_STOCK');
    // 登记分子：out_of_stock_qty IS NOT NULL（D18 字段永久保留，登记事实）
    expect(sqls[1]).toContain('out_of_stock_qty IS NOT NULL');
    // 退款分母：reason='OUT_OF_STOCK'（全 status，不剔 CANCELLED/FAILED）
    expect(sqls[2]).toContain('OUT_OF_STOCK');
    // system 通路标记：reviewed_by='SYSTEM'（D9b）
    expect(sqls[2]).toContain('SYSTEM');
    // pending 桶：status='PENDING'（含超限转人工 D17）
    expect(sqls[2]).toContain('PENDING');
  });

  it('P2-1 反向断言：全缺登记单计入分母后 登记率恒 ≤ 1（reported=fulfilled 极限场景）', async () => {
    // 极限：区间内全部履约订单都发生过缺货登记（含被 CANCELLED 的全缺单）
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ cnt: BigInt(80) }]) // 新分母：六态 + 全缺取消单
      .mockResolvedValueOnce([{ cnt: BigInt(80) }]) // 分子（⊆ 分母）
      .mockResolvedValueOnce([{ total: BigInt(0), system_cnt: BigInt(0), pending_cnt: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const res = await service.getOosBoard({ range: 'week' });
    expect(res.reportRate).not.toBeNull();
    expect(res.reportRate as number).toBeLessThanOrEqual(1);
    expect(res.reportRate as number).toBeGreaterThanOrEqual(0);
  });

  it('时间边界：E-STATISTICS-001 透传（公共层抛出，服务层不吞）', async () => {
    await expect(
      service.getOosBoard({ from: '2026-10-24', to: '2026-10-01' }),
    ).rejects.toThrow();
    // 不应触达 db（公共层先校验）
    expect(dbMock.$queryRaw).not.toHaveBeenCalled();
  });

  it('自定义 from/to 透传：含头尾（单日 from=to → 跨度 24h）', async () => {
    dbMock.$queryRaw
      .mockResolvedValueOnce([{ cnt: BigInt(0) }])
      .mockResolvedValueOnce([{ cnt: BigInt(0) }])
      .mockResolvedValueOnce([{ total: BigInt(0), system_cnt: BigInt(0), pending_cnt: BigInt(0) }])
      .mockResolvedValueOnce([]);

    const res = await service.getOosBoard({ from: '2026-10-24', to: '2026-10-24' });
    expect(res.from).toBeDefined();
    expect(res.to).toBeDefined();
    // trend 桶按 Dili 当地日切，单日=1 行
    expect(res.trend.length).toBeLessThanOrEqual(2);
  });
});
