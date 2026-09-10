/**
 * StatisticsService 单测（数据分析报表模块 批B，2026-09-10）
 *
 * 重点验证（任务书 §2 改动 8）：
 *   - 聚合正确性：多商品映射 / 并列排序（gmvAmount 降序 → quantitySold）/ limit 透传
 *   - 时间边界：预设透传 / 自定义 range 透传 / E-STATISTICS-001/002 透传
 *   - 商品名快照 lang 切片 fallback en
 * CSV 转义测试在 statistics-csv.service.test.ts（B4 验收依赖）
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

import { StatisticsService } from '../src/modules/statistics/statistics.service';
import { db } from '../src/shared/db';

const dbMock = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
};

describe('StatisticsService.getTopProducts', () => {
  let service: StatisticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$queryRaw.mockResolvedValue([]);
    service = new StatisticsService();
  });

  /** 造一行聚合 mock 数据 */
  function row(
    productId: string,
    name: Record<string, string>,
    gmv: number,
    qty: number,
    orders: number,
  ) {
    return {
      product_id: productId,
      product_name: name,
      product_image: null,
      order_count: BigInt(orders),
      quantity_sold: BigInt(qty),
      gmv_amount: BigInt(gmv),
    };
  }

  describe('聚合正确性（多商品/排序/limit）', () => {
    it('多商品映射：字段转换 + BigInt → number', async () => {
      dbMock.$queryRaw.mockResolvedValue([
        row('11111111-1111-1111-1111-111111111111', { en: 'Apple', zh: '苹果' }, 1999, 10, 7),
        row('22222222-2222-2222-2222-222222222222', { en: 'Milk' }, 500, 3, 2),
      ]);

      const res = await service.getTopProducts({ range: 'week', limit: 10, lang: 'zh' });

      expect(res.items).toHaveLength(2);
      expect(res.items[0]).toEqual({
        productId: '11111111-1111-1111-1111-111111111111',
        productName: '苹果',
        productImage: null,
        orderCount: 7,
        quantitySold: 10,
        gmvAmount: 1999,
      });
      expect(res.items[1].productName).toBe('Milk');
      // 金额单位分（不换算）
      expect(res.items[1].gmvAmount).toBe(500);
    });

    it('排序：SQL 已按 gmvAmount 降序 → 并列按 quantitySold 降序（服务层保序透传）', async () => {
      // 并列 gmv=1000 的两个商品，quantity 高者在前（SQL ORDER BY 语义，服务层不重排）
      // mock 数组须给"SQL 已排序"的顺序：C(gmv 2000) 在前，B/A 并列 1000 按 quantity 8>5
      dbMock.$queryRaw.mockResolvedValue([
        row('55555555-5555-5555-5555-555555555555', { en: 'C' }, 2000, 1, 1),
        row('33333333-3333-3333-3333-333333333333', { en: 'B' }, 1000, 8, 3),
        row('44444444-4444-4444-4444-444444444444', { en: 'A' }, 1000, 5, 2),
      ]);

      const res = await service.getTopProducts({ range: 'week', limit: 10, lang: 'en' });
      const ids = res.items.map((i) => i.productName);
      expect(ids).toEqual(['C', 'B', 'A']);
    });

    it('limit 透传到 SQL（默认 10，上限 50 由契约层约束）', async () => {
      dbMock.$queryRaw.mockResolvedValue([]);
      await service.getTopProducts({ range: 'today', limit: 25, lang: 'en' });
      // tagged template 第 2 个参数链里包含 limit 值（Prisma $queryRaw 参数展开）
      const templateArg = dbMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
      const interpolated = dbMock.$queryRaw.mock.calls[0].slice(1);
      expect(templateArg.join('')).toContain('LIMIT');
      expect(interpolated).toContain(25);
    });
  });

  describe('时间边界（预设 + 自定义透传）', () => {
    it('预设 range 透传给 buildRange（today 返回 24 小时桶语义的 from/to）', async () => {
      dbMock.$queryRaw.mockResolvedValue([]);
      const res = await service.getTopProducts({ range: 'today', limit: 10, lang: 'en' });
      // from = Dili 今日 0 点 = UTC 前日 15 点（用相对断言：to - from ≤ 24h）
      const from = new Date(res.from).getTime();
      const to = new Date(res.to).getTime();
      expect(to - from).toBeLessThanOrEqual(24 * 3600 * 1000);
      expect(to - from).toBeGreaterThan(0);
    });

    it('自定义 from/to 透传：含头尾（单日 from=to → 跨度 24h）', async () => {
      dbMock.$queryRaw.mockResolvedValue([]);
      const res = await service.getTopProducts({
        from: '2026-06-23',
        to: '2026-06-23',
        limit: 10,
        lang: 'en',
      });
      const from = new Date(res.from).getTime();
      const to = new Date(res.to).getTime();
      // Dili 2026-06-23 0:00 ~ 次日 0:00 = UTC 2026-06-22 15:00 ~ 06-23 15:00
      expect(res.from).toBe('2026-06-22T15:00:00.000Z');
      expect(res.to).toBe('2026-06-23T15:00:00.000Z');
      expect(to - from).toBe(24 * 3600 * 1000);
    });

    it('to < from → E-STATISTICS-001 透传（公共层抛出，服务层不吞）', async () => {
      await expect(
        service.getTopProducts({ from: '2026-06-23', to: '2026-06-20', limit: 10, lang: 'en' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'E-STATISTICS-001' },
      });
    });

    it('跨期 > 366 天 → E-STATISTICS-002 透传', async () => {
      await expect(
        service.getTopProducts({ from: '2025-01-01', to: '2026-06-23', limit: 10, lang: 'en' }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: 'E-STATISTICS-002' },
      });
    });
  });

  describe('商品名快照 lang 切片', () => {
    it('缺当前语 fallback en（pickI18nField 链 lang → en → ""）', async () => {
      dbMock.$queryRaw.mockResolvedValue([
        row('66666666-6666-6666-6666-666666666666', { en: 'Instant Noodle' }, 900, 4, 3),
      ]);
      const res = await service.getTopProducts({ range: 'week', limit: 10, lang: 'zh' });
      expect(res.items[0].productName).toBe('Instant Noodle');
    });
  });
});

/**
 * 骑手绩效（批C，2026-09-10 / R5 口径）
 *
 * $queryRaw 依次被调：第 1 次 = delivery_tasks 聚合，第 2 次 = settlements 收入聚合
 */
describe('StatisticsService.getRiders', () => {
  let service: StatisticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$queryRaw.mockReset();
    dbMock.$queryRaw.mockResolvedValue([]);
    service = new StatisticsService();
  });

  /** 造一行 delivery_tasks 聚合 mock */
  function riderRow(riderId: string, name: string, completed: number, abnormal: number, rating = 4.5) {
    return {
      rider_id: riderId,
      rider_name: name,
      rating,
      completed_orders: BigInt(completed),
      abnormal_count: BigInt(abnormal),
    };
  }

  it('完成单归属三值命中：task 关联 Order 三值由 SQL 判定，服务层透传计数', async () => {
    // SQL 内已完成状态过滤（CASE WHEN o.status IN 三值），mock 只验映射
    dbMock.$queryRaw.mockResolvedValueOnce([
      riderRow('11111111-1111-1111-1111-111111111111', 'João', 12, 1),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const res = await service.getRiders({ range: 'week' });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual({
      riderId: '11111111-1111-1111-1111-111111111111',
      riderName: 'João',
      completedOrders: 12,
      income: 0,
      rating: 4.5,
      abnormalCount: 1,
    });
  });

  it('完成单不命中/异常归属：completedOrders=0 + abnormalCount 保留（CANCELLED 场景 riderId 保留在 task）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      riderRow('22222222-2222-2222-2222-222222222222', 'Maria', 0, 3),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const res = await service.getRiders({ range: 'month' });
    expect(res.items[0].completedOrders).toBe(0);
    expect(res.items[0].abnormalCount).toBe(3);
  });

  it('收入聚合：Settlement periodDate 过滤由 SQL 判定，各 status 均计入 → income 按 subjectId 映射', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      riderRow('33333333-3333-3333-3333-333333333333', 'Ali', 5, 0),
      riderRow('44444444-4444-4444-4444-444444444444', 'Budi', 2, 0),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([
      { subject_id: '33333333-3333-3333-3333-333333333333', income: BigInt(15000) },
      // 55555555 只在 settlements 有、无 delivery task → 不出现在 items（骑手维度以 task 为锚）
      { subject_id: '55555555-5555-5555-5555-555555555555', income: BigInt(999) },
    ]);

    const res = await service.getRiders({ range: 'week' });
    expect(res.items[0].income).toBe(15000);
    expect(res.items[1].income).toBe(0);
    expect(res.items).toHaveLength(2);
  });

  it('排序：completedOrders 降序，并列按 income 降序（服务层 sort 语义）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      riderRow('aaaa1111-1111-1111-1111-111111111111', 'Low', 1, 0),
      riderRow('aaaa2222-2222-2222-2222-222222222222', 'TopA', 10, 0),
      riderRow('aaaa3333-3333-3333-3333-333333333333', 'TopB', 10, 0),
      riderRow('aaaa4444-4444-4444-4444-444444444444', 'TopC', 10, 0),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([
      { subject_id: 'aaaa3333-3333-3333-3333-333333333333', income: BigInt(3000) },
      { subject_id: 'aaaa4444-4444-4444-4444-444444444444', income: BigInt(2000) },
      { subject_id: 'aaaa2222-2222-2222-2222-222222222222', income: BigInt(2000) },
    ]);

    const res = await service.getRiders({ range: 'week' });
    const names = res.items.map((i) => i.riderName);
    // 10 单组内：3000 > 2000(TopB) = 2000(TopA，无收入并列保序) ；1 单组垫底
    expect(names).toEqual(['TopB', 'TopA', 'TopC', 'Low']);
  });

  it('时间边界：自定义 from/to 含头尾（Dili 切日 → UTC 前日 15:00）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([]);
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const res = await service.getRiders({ from: '2026-06-23', to: '2026-06-23' });
    expect(res.from).toBe('2026-06-22T15:00:00.000Z');
    expect(res.to).toBe('2026-06-23T15:00:00.000Z');
  });

  it('E-STATISTICS-001/002 透传（公共层抛出，服务层不吞）', async () => {
    await expect(
      service.getRiders({ from: '2026-06-23', to: '2026-06-20' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-001' } });
    await expect(
      service.getRiders({ from: '2025-01-01', to: '2026-06-23' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-002' } });
  });

  it('rating 快照映射 Number(rating)（Prisma Decimal → number）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      riderRow('66666666-6666-6666-6666-666666666666', 'Rui', 4, 0, '4.85'),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([]);

    const res = await service.getRiders({ range: 'today' });
    expect(res.items[0].rating).toBe(4.85);
  });
});
