/**
 * 技术债收尾批3（2026-10-30）：getRecommendations P3-2 diversity + P3-1 批内去重
 *
 * 覆盖验收线 A3.1/A3.2：
 * - P3-2 行为等价断言（R-v2-1）：非挤压场景（各偏好类目池内均有代表，现网 23<30 基线）
 *   输出与改造前逐字节一致；仅挤压场景（头部类目占满 limit*5 窗口）追加补位
 * - P3-2 三场景：单类目挤占（补位生效）/ 正常混合（等价回归）/ 候选不足（空池回退）
 * - P3-1：候选耗尽回退销量切片时排除池内 id（批内去重 notIn）
 *
 * mock 分流说明：product.findMany 有 4 类调用形态——
 *   ① 历史商品回查 where.id.in｜② 类目池 where.categoryId.in 无 select｜
 *   ③ top3 徽章 where.categoryId.in + select（assembleProductCards 附属）｜
 *   ④ 回退销量切片 where.id.notIn。按 where 键 + select 区分。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  productFindMany: vi.fn(),
  skuFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  stockFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  redisGet: vi.fn(),
  redisIncr: vi.fn(),
  setWithTTL: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: m.queryRaw,
    product: { findMany: m.productFindMany },
    sku: { findMany: m.skuFindMany },
    category: { findMany: m.categoryFindMany },
    stock: { findMany: m.stockFindMany },
    review: { groupBy: m.reviewGroupBy },
    systemConfig: { findUnique: m.systemConfigFindUnique },
  },
}));

vi.mock('../src/shared/cache/redis', () => ({
  redis: { get: m.redisGet, incr: m.redisIncr },
  setWithTTL: m.setWithTTL,
}));

// top3 徽章走独立 helper（真实实现会另发 findMany 干扰调用计数）→ 整模块 mock 掉
vi.mock('../src/shared/db/category-top3', () => ({
  getCategoryTop3ProductIds: vi.fn().mockResolvedValue(new Set()),
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';
import { resetRecommendationConfigCacheForTest } from '../src/modules/catalog/recommendation.config';
import { resetCollaborativeConfigCacheForTest } from '../src/modules/catalog/collaborative.config';

type FmArgs = {
  where?: { id?: { in?: string[]; notIn?: string[] }; categoryId?: unknown; status?: string };
  select?: unknown;
  take?: number;
  skip?: number;
};

const isHistoryCall = (a: FmArgs) => Array.isArray(a.where?.id?.in);
const isFallbackCall = (a: FmArgs) => Array.isArray(a.where?.id?.notIn);
const isPoolCall = (a: FmArgs) =>
  !isHistoryCall(a) && !isFallbackCall(a) && !a.select && a.where?.categoryId != null;
const isTop3Call = (a: FmArgs) => Boolean(a.select);

const productRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  shopId: 'shop-1',
  categoryId: null,
  name: { en: `P-${id}` },
  description: null,
  mainImage: 'img.png',
  images: [],
  status: 'ACTIVE',
  unit: { en: 'bag' },
  priceMin: 1500,
  salesCount: 100,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  ...overrides,
});

/** 聚合历史 rows mock（buildCategoryPreferencePool 的 $queryRaw）；times>1 支持同测多次调用 */
const mockHistory = (
  rows: Array<{ product_id: string; freq: bigint; category_id: string | null }>,
  times = 1,
) => {
  for (let i = 0; i < times; i++) {
    m.queryRaw.mockResolvedValueOnce(
      rows.map((r) => ({ ...r, last_at: new Date('2026-01-05') })),
    );
  }
};

describe('getRecommendations 批3：P3-2 diversity + P3-1 批内去重', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRecommendationConfigCacheForTest();
    resetCollaborativeConfigCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null); // personalRanking OFF（默认路径）
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.skuFindMany.mockResolvedValue([]);
    m.redisGet.mockResolvedValue(null);
    service = new CatalogService(
      { recordSearch: vi.fn().mockResolvedValue(undefined) } as never,
      { getSimilarSignalMap: vi.fn().mockResolvedValue(new Map()) } as never,
    );
  });

  it('P3-2 正常混合场景（等价断言）：各偏好类目池内均有代表 → 输出与旧「按偏好顺序逐类目取满」逐字节一致，无补位查询', async () => {
    // 历史：cat-1 频次高，cat-2 次之；各买过 1 件
    mockHistory([
      { product_id: 'prod-h1', freq: 3n, category_id: 'cat-1' },
      { product_id: 'prod-h2', freq: 1n, category_id: 'cat-2' },
    ]);
    m.productFindMany.mockImplementation(async (args: FmArgs) => {
      if (isHistoryCall(args))
        return [productRow('prod-h1', { categoryId: 'cat-1' }), productRow('prod-h2', { categoryId: 'cat-2' })];
      if (isPoolCall(args)) {
        return [
          productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 }),
          productRow('prod-s2', { categoryId: 'cat-2', salesCount: 400 }),
          productRow('prod-s3', { categoryId: 'cat-1', salesCount: 300 }),
        ];
      }
      if (isTop3Call(args)) return [];
      throw new Error('unexpected product.findMany call: ' + JSON.stringify(args.where));
    });

    const result = await service.getRecommendations('user-A', 6);

    // 等价断言：历史序 + 按偏好类目顺序取满（cat-1 两条 → cat-2 一条），无 order 变化
    expect(result.map((r) => r.id)).toEqual([
      'prod-h1',
      'prod-h2',
      'prod-s1',
      'prod-s3',
      'prod-s2',
    ]);
    // 无补位查询：product.findMany 恰好 2 次业务调用（历史 + 类目池；top3 已模块级 mock 不计数），
    // 无第 3 次单类目补位查询
    expect(m.productFindMany).toHaveBeenCalledTimes(2);
  });

  it('P3-2 单类目挤占场景：头部类目占满池窗口 → 被挤压类目 per-category 补位追加池尾', async () => {
    // 历史：cat-2 买过 1 件（频次低排后），cat-1 是头部偏好
    mockHistory(
      [
        { product_id: 'prod-h2', freq: 1n, category_id: 'cat-2' },
        { product_id: 'prod-h1', freq: 1n, category_id: 'cat-1' },
      ],
      2,
    );
    m.productFindMany.mockImplementation(async (args: FmArgs) => {
      if (isHistoryCall(args))
        return [productRow('prod-h2', { categoryId: 'cat-2' }), productRow('prod-h1', { categoryId: 'cat-1' })];
      if (isPoolCall(args)) {
        // 挤压：limit*5=30 窗口被 cat-1 占满，cat-2 在池内 0 代表
        return Array.from({ length: args.take ?? 30 }, (_, i) =>
          productRow(`prod-c1-${i}`, { categoryId: 'cat-1', salesCount: 1000 - i }),
        );
      }
      if (isFallbackCall(args)) {
        // 补位查询：categoryId 单值 + notIn（实现在池构建内，形态与回退切片同构）
        return [productRow('prod-topup-1', { categoryId: 'cat-2', salesCount: 50 })];
      }
      if (isTop3Call(args)) return [];
      throw new Error('unexpected');
    });

    // 挤压信号触发：补位固定追加池尾（池 = 2 历史 + 30 头部 + 1 补位 = 33 席），
    //   首屏 slice(0,30) 不含补位（已翻页不受扰——等价性红线）；池尾页（offset=30）
    //   切片 = [c1-28, c1-29, 补位] → 被挤占类目商品在超阈场景进入输出
    const first = await service.getRecommendations('user-A', 30);
    expect(first.map((r) => r.id)).not.toContain('prod-topup-1');
    expect(first.map((r) => r.id)[0]).toBe('prod-h2');
    const tail = await service.getRecommendations('user-A', 6, 30);
    expect(tail.map((r) => r.id)).toContain('prod-topup-1');
    // 补位查询确实发起（categoryId 单值 = cat-2 的 notIn 查询恰好 2 次：两次池构建各 1 次）；
    // mock.calls 元素是 [args] 数组，取 c[0]
    const calls = (m.productFindMany.mock.calls as unknown as FmArgs[][]).map((c) => c[0]);
    expect(
      calls.filter((c) => isFallbackCall(c) && c.where?.categoryId === 'cat-2').length,
    ).toBe(2);
  });

  it('P3-2 候选不足场景：历史为空且池空 → 回退销量切片（匿名分支行为不变）', async () => {
    mockHistory([]); // 无历史
    m.productFindMany.mockResolvedValueOnce([productRow('prod-sale-1')]); // 底部匿名回退

    const result = await service.getRecommendations('user-A', 6);

    expect(result.map((r) => r.id)).toEqual(['prod-sale-1']);
    // 未触类目池查询（rows 空 → 早退），仅 1 次 findMany（回退切片）
    expect(m.productFindMany).toHaveBeenCalledTimes(1);
  });

  it('P3-1 批内去重：offset 翻出池尾 → 回退销量切片排除池内 id（notIn），不重复展示', async () => {
    // 历史 1 件 + 池 2 件（池总量 3 < offset=12 → 切片空触发回退）
    mockHistory([{ product_id: 'prod-h1', freq: 2n, category_id: 'cat-1' }]);
    const poolIds = ['prod-h1', 'prod-s1'];
    m.productFindMany.mockImplementation(async (args: FmArgs) => {
      if (isHistoryCall(args)) return [productRow('prod-h1', { categoryId: 'cat-1' })];
      if (isPoolCall(args)) {
        return [
          productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 }),
          productRow('prod-s2', { categoryId: 'cat-2', salesCount: 400 }),
        ];
      }
      if (isFallbackCall(args)) {
        // 回退销量切片：断言 notIn 排除池内全部 id + skip: offset
        // notIn = 全池 id：池实际为 [prod-h1（历史）, prod-s1]——prod-s2 的类目 cat-2
        //   不在偏好类目（历史只买过 cat-1）→ 不进池，池总量 2 < offset=12 触发回退
        expect(args.where?.id?.notIn).toEqual(expect.arrayContaining(poolIds));
        expect(args.skip).toBe(12);
        return [productRow('prod-sale-x', { salesCount: 10 })];
      }
      if (isTop3Call(args)) return [];
      throw new Error('unexpected');
    });

    const result = await service.getRecommendations('user-A', 6, 12);

    // 回退项不含池内 id（批内去重生效）
    expect(result.map((r) => r.id)).toEqual(['prod-sale-x']);
    expect(result.every((r) => !poolIds.includes(r.id))).toBe(true);
  });

  it('P3-1 对照（回归红线）：offset=0 首屏个性化路径不触回退，输出与改造前一致', async () => {
    mockHistory([{ product_id: 'prod-h1', freq: 2n, category_id: 'cat-1' }]);
    m.productFindMany.mockImplementation(async (args: FmArgs) => {
      if (isHistoryCall(args)) return [productRow('prod-h1', { categoryId: 'cat-1' })];
      if (isPoolCall(args)) return [productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 })];
      if (isFallbackCall(args)) throw new Error('offset=0 不应触回退销量查询');
      if (isTop3Call(args)) return [];
      throw new Error('unexpected');
    });

    const result = await service.getRecommendations('user-A', 6);

    expect(result.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1']);
    // 历史 + 池 + top3 徽章，无回退切片
    const calls = m.productFindMany.mock.calls as unknown as FmArgs[];
    expect(calls.filter((c) => isFallbackCall(c))).toHaveLength(0);
  });
});
