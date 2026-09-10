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

/**
 * 退款统计（批D，2026-09-10 / 数据口径.md §2）
 *
 * $queryRaw 依次被调：第 1 次 = refunds 原因分布聚合，第 2 次 = orders GMV 分母
 * 计入状态过滤（APPROVED/COMPLETED 计入 vs PENDING/REJECTED/FAILED/CANCELLED 不计入）
 * 由 SQL WHERE 判定——单测验证 SQL 文本含状态集 + 服务层映射逻辑（reason 归并/排序/率计算）
 */
describe('StatisticsService.getRefunds', () => {
  let service: StatisticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$queryRaw.mockReset();
    dbMock.$queryRaw.mockResolvedValue([]);
    service = new StatisticsService();
  });

  /** 造一行 refunds groupBy mock */
  function refundRow(reason: string, cnt: number, amount: number) {
    return { reason, cnt: BigInt(cnt), amount: BigInt(amount) };
  }

  it('计入口径状态集出现在 SQL（APPROVED/COMPLETED 计入；PENDING 等由 WHERE 排除）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(5) }]);

    await service.getRefunds({ range: 'week' });

    // 第 1 次调用（refunds 聚合）：服务层 Prisma 来自本地生成客户端（real sqltag/join，
    // 形如 { strings, values }，嵌套 SQL 展平进 values）——递归收集 strings/values 断言
    const seen: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { seen.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.strings)) o.strings.forEach(walk);
        if (Array.isArray(o.values)) o.values.forEach(walk);
        if (typeof o.sql === 'string') seen.push(o.sql);
        if (Array.isArray(o.vals)) o.vals.forEach(walk);
        if (Array.isArray(o.parts)) o.parts.forEach(walk);
      }
    };
    walk(dbMock.$queryRaw.mock.calls[0]);
    const joined = seen.join(' ');
    expect(joined).toContain('APPROVED');
    expect(joined).toContain('COMPLETED');
    expect(joined).not.toContain('PENDING');
    expect(joined).not.toContain('REJECTED');
  });

  it('金额/单量汇总：多原因映射 + BigInt → number + 总和正确', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      refundRow('QUALITY_ISSUE', 3, 1500),
      refundRow('OUT_OF_STOCK', 2, 800),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(50) }]);

    const res = await service.getRefunds({ range: 'month' });
    expect(res.refundCount).toBe(5);
    expect(res.refundAmount).toBe(2300);
    expect(res.reasonBreakdown).toHaveLength(2);
  });

  it('reasonBreakdown 按 amount 降序', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      refundRow('OUT_OF_STOCK', 2, 800),
      refundRow('QUALITY_ISSUE', 3, 1500),
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(50) }]);

    const res = await service.getRefunds({ range: 'week' });
    expect(res.reasonBreakdown.map((r) => r.reason)).toEqual(['QUALITY_ISSUE', 'OUT_OF_STOCK']);
  });

  it('reason 约定外值归 OTHER（TEXT 无 CHECK 容错，同 OTHER 已有值时归并）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([
      refundRow('WEIRD_DB_VALUE', 1, 100), // 不在 8 约定值 → OTHER
      refundRow('OTHER', 2, 300), // 已有 OTHER → 归并到同一行
    ]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(10) }]);

    const res = await service.getRefunds({ range: 'week' });
    expect(res.reasonBreakdown).toHaveLength(1);
    expect(res.reasonBreakdown[0]).toEqual({ reason: 'OTHER', count: 3, amount: 400 });
  });

  it('rate 分母 = 同期 GMV 状态订单数；退款率 = refundCount / gmvOrderCount', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([refundRow('EXPIRED', 4, 1200)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(200) }]);

    const res = await service.getRefunds({ range: 'week' });
    expect(res.gmvOrderCount).toBe(200);
    expect(res.rate).toBe(4 / 200); // 0.02
  });

  it('rate 分母 0（同期无 GMV 状态订单）→ rate = null', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([refundRow('EXPIRED', 4, 1200)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);

    const res = await service.getRefunds({ range: 'week' });
    expect(res.gmvOrderCount).toBe(0);
    expect(res.rate).toBeNull();
  });

  it('时间边界：自定义 from/to 含头尾（Dili 切日 → UTC 前日 15:00）+ E-STATISTICS 透传', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);

    const res = await service.getRefunds({ from: '2026-06-23', to: '2026-06-23' });
    expect(res.from).toBe('2026-06-22T15:00:00.000Z');
    expect(res.to).toBe('2026-06-23T15:00:00.000Z');

    await expect(
      service.getRefunds({ from: '2026-06-23', to: '2026-06-20' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-001' } });
    await expect(
      service.getRefunds({ from: '2025-01-01', to: '2026-06-23' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-002' } });
  });
});

/**
 * 客户分析（批E，2026-09-10 / 方案v2 §3.2 customers 行 · R4 MVP 三指标）
 *
 * $queryRaw 依次被调：第 1 次 = groupBy user_id 主聚合（订单数/用户数/GMV/新客），
 * 第 2 次 = 复购用户数（HAVING COUNT(*) >= 2）
 * 新客判定 = 全局首单（first_order 子查询 min(created_at)）落在区间内——SQL 判定，
 * 单测验证 SQL 文本含 first_order 全局首单子查询 + 服务层映射/率计算/分母 0 语义
 */
describe('StatisticsService.getCustomers', () => {
  let service: StatisticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.$queryRaw.mockReset();
    dbMock.$queryRaw.mockResolvedValue([]);
    service = new StatisticsService();
  });

  /** 造主聚合单行 mock（orders/orders users/gmv/new） */
  function mainRow(orderCnt: number, userCnt: number, gmv: number, newUsers: number) {
    return {
      order_cnt: BigInt(orderCnt),
      user_cnt: BigInt(userCnt),
      gmv: BigInt(gmv),
      new_users: BigInt(newUsers),
    };
  }

  it('新客判定走全局首单子查询（SQL 含 first_order min(created_at)，非"区间内有单"）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(10, 4, 50000, 2)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(1) }]);

    await service.getCustomers({ range: 'week' });

    // 第 1 次调用（主聚合）：递归收集真实 Prisma sqltag strings/values，
    // 断言全局首单子查询（first_order + MIN(created_at)）存在 + GMV 状态集出现
    const seen: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') { seen.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        if (Array.isArray(o.strings)) o.strings.forEach(walk);
        if (Array.isArray(o.values)) o.values.forEach(walk);
        if (typeof o.sql === 'string') seen.push(o.sql);
        if (Array.isArray(o.vals)) o.vals.forEach(walk);
        if (Array.isArray(o.parts)) o.parts.forEach(walk);
      }
    };
    walk(dbMock.$queryRaw.mock.calls[0]);
    const joined = seen.join(' ');
    expect(joined).toContain('first_order');
    expect(joined).toContain('MIN(created_at)');
    // 分母口径与批A/D 同源：GMV 状态集出现在 WHERE
    expect(joined).toContain('status');
  });

  it('新客/复购/基数映射：BigInt → number 全链', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(10, 4, 50000, 2)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(1) }]);

    const res = await service.getCustomers({ range: 'week' });
    expect(res.newCustomers).toBe(2);
    expect(res.repeatCustomers).toBe(1);
    expect(res.gmvOrderCount).toBe(10);
    expect(res.orderUserCount).toBe(4);
  });

  it('repeatRate = repeatCustomers / orderUserCount（区间下单用户数，非订单数）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(10, 4, 50000, 2)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(1) }]);

    const res = await service.getCustomers({ range: 'week' });
    expect(res.repeatRate).toBe(1 / 4);
  });

  it('avgOrderValue = GMV / 订单数（AOV）——不是 GMV/用户数（防写错成 ARPU，v2 🔧）', async () => {
    // 10 单 4 用户 GMV 50000 → AOV = 5000（若错写成 ARPU = 12500）
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(10, 4, 50000, 2)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(1) }]);

    const res = await service.getCustomers({ range: 'month' });
    expect(res.avgOrderValue).toBe(5000);
    expect(res.avgOrderValue).not.toBe(12500);
  });

  it('复购 = 区间 ≥2 单（SQL HAVING COUNT(*) >= 2 判定，1 单不计入）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(3, 3, 9000, 3)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);

    const res = await service.getCustomers({ range: 'today' });
    expect(res.repeatCustomers).toBe(0);
    expect(res.repeatRate).toBe(0); // 0/3
  });

  it('零分母 nullable：无下单用户 → repeatRate=null；无订单 → avgOrderValue=null（对齐批D 范式）', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(0, 0, 0, 0)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);

    const res = await service.getCustomers({ range: 'today' });
    expect(res.orderUserCount).toBe(0);
    expect(res.repeatRate).toBeNull();
    expect(res.gmvOrderCount).toBe(0);
    expect(res.avgOrderValue).toBeNull();
  });

  it('时间边界：自定义 from/to 含头尾（Dili 切日 → UTC 前日 15:00）+ E-STATISTICS 透传', async () => {
    dbMock.$queryRaw.mockResolvedValueOnce([mainRow(0, 0, 0, 0)]);
    dbMock.$queryRaw.mockResolvedValueOnce([{ cnt: BigInt(0) }]);

    const res = await service.getCustomers({ from: '2026-06-23', to: '2026-06-23' });
    expect(res.from).toBe('2026-06-22T15:00:00.000Z');
    expect(res.to).toBe('2026-06-23T15:00:00.000Z');

    await expect(
      service.getCustomers({ from: '2026-06-23', to: '2026-06-20' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-001' } });
    await expect(
      service.getCustomers({ from: '2025-01-01', to: '2026-06-23' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'E-STATISTICS-002' } });
  });
});
