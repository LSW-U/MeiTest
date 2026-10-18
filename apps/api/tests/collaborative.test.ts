/**
 * Collaborative Filtering 单测（客户画像批6 2026-10-18）
 *
 * 覆盖任务书验收线：
 *   P6-1 相似度可解释（证据字段 sourceCount/minScore）+ 结果可回溯（computedAt）
 *   P6-2 读路径读物化不现算（getMaterializedPicks/getSimilarSignalMap 单查询）
 *   P6-3 B7 默认关回归红线：OFF 与批3 现状逐字节一致（不触协同过滤依赖）
 *   P6-4 A9 语义：匿名/无结果回空数组不报错；只出商品不出人（响应无邻居身份）
 *   共现计算边界：单买家（无邻居不物化）/ 自排除 / 已购过滤 / minSourceCount
 *   权重融合可配：b7SimilarWeight=0 逐字节等价现状 / 权重生效改变排序
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ===== mock db / redis / logger =====
const m = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  pickFindMany: vi.fn(),
  pickDeleteMany: vi.fn(),
  pickCreateMany: vi.fn(),
  productFindMany: vi.fn(),
  skuFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  stockFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  loggerWarn: vi.fn(),
  loggerInfo: vi.fn(),
}));

// $transaction mock：回调拿到 tx（deleteMany/createMany 独立 mock 便于断言事务内调用）
vi.mock('../src/shared/db', () => ({
  db: {
    $queryRaw: m.queryRaw,
    similarUserPick: { findMany: m.pickFindMany },
    product: { findMany: m.productFindMany },
    sku: { findMany: m.skuFindMany },
    category: { findMany: m.categoryFindMany },
    stock: { findMany: m.stockFindMany },
    review: { groupBy: m.reviewGroupBy },
    systemConfig: { findUnique: m.systemConfigFindUnique },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        similarUserPick: {
          deleteMany: m.pickDeleteMany,
          createMany: m.pickCreateMany,
        },
      }),
  },
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: m.loggerWarn, info: m.loggerInfo, error: vi.fn() },
}));

import { CollaborativeFilterService } from '../src/modules/catalog/collaborative-filter.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import {
  parseCollaborativeConfig,
  COLLABORATIVE_DEFAULTS,
  resetCollaborativeConfigCacheForTest,
} from '../src/modules/catalog/collaborative.config';
import { resetRecommendationConfigCacheForTest } from '../src/modules/catalog/recommendation.config';

const FIXED_NOW = new Date('2026-10-18T03:15:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  resetCollaborativeConfigCacheForTest();
  resetRecommendationConfigCacheForTest();
  m.systemConfigFindUnique.mockResolvedValue(null); // 配置全默认
});

// ==================== 配置解析 ====================

describe('批6 配置解析（G5）', () => {
  it('parseCollaborativeConfig：partial merge 默认值，非法回退', () => {
    const ok = parseCollaborativeConfig(JSON.stringify({ neighborTopK: 5, b7SimilarWeight: 0.5 }));
    expect(ok).toEqual({ ...COLLABORATIVE_DEFAULTS, neighborTopK: 5, b7SimilarWeight: 0.5 });
    expect(parseCollaborativeConfig('not-json')).toEqual(COLLABORATIVE_DEFAULTS);
    expect(parseCollaborativeConfig(JSON.stringify({ neighborTopK: 0 }))).toEqual(
      COLLABORATIVE_DEFAULTS,
    );
    expect(parseCollaborativeConfig(null)).toEqual(COLLABORATIVE_DEFAULTS);
  });
});

// ==================== 共现重算边界（P6-1） ====================

describe('协同过滤重算 recomputeAll', () => {
  const svc = new CollaborativeFilterService();

  /** 两用户-商品行为矩阵 → queryRaw mock（DISTINCT user/product 行） */
  const mockMatrix = (rows: Array<{ user_id: string; product_id: string }>) => {
    m.queryRaw.mockResolvedValueOnce(rows);
  };

  it('P6-1 正常重算：Jaccard 相似度 + 已购过滤 + 证据字段（sourceCount/minScore/computedAt）', async () => {
    // u1 买 [a,b,c]，u2 买 [a,b,d] → inter=2 union=4 sim=0.5
    // u3 买 [a,x] → u1∩u3={a} union=4 sim=0.25
    mockMatrix([
      { user_id: 'u1', product_id: 'a' },
      { user_id: 'u1', product_id: 'b' },
      { user_id: 'u1', product_id: 'c' },
      { user_id: 'u2', product_id: 'a' },
      { user_id: 'u2', product_id: 'b' },
      { user_id: 'u2', product_id: 'd' },
      { user_id: 'u3', product_id: 'a' },
      { user_id: 'u3', product_id: 'x' },
    ]);
    m.pickDeleteMany.mockResolvedValue({ count: 0 });
    m.pickCreateMany.mockResolvedValue({ count: 0 });

    const r = await svc.recomputeAll(FIXED_NOW);
    expect(r.users).toBe(3);

    // u1 的推荐：u2 邻居贡献 d（u1 未买）、u3 邻居贡献 x
    const u1Rows = m.pickCreateMany.mock.calls[0][0].data.filter(
      (p: { userId: string }) => p.userId === 'u1',
    );
    const d = u1Rows.find((p: { productId: string }) => p.productId === 'd');
    expect(d).toBeDefined();
    // score 归一：d 只由 u2 贡献 → d.score = 0.5 / (0.5+0.25) ≈ 0.667；sourceCount=1；minScore=0.5
    expect(d.score).toBeCloseTo(0.5 / 0.75, 5);
    expect(d.sourceCount).toBe(1);
    expect(d.minScore).toBeCloseTo(0.5, 5);
    expect(d.computedAt).toEqual(FIXED_NOW); // 可回溯：批次时间
    const x = u1Rows.find((p: { productId: string }) => p.productId === 'x');
    expect(x).toBeDefined();
    expect(x.score).toBeCloseTo(0.25 / 0.75, 5);
    // d > x（相似度权重排序）
    expect(d.score).toBeGreaterThan(x.score);
  });

  it('单买家：无邻居对 → 不物化任何行（users=1 picks=0）', async () => {
    mockMatrix([{ user_id: 'solo', product_id: 'a' }]);
    const r = await svc.recomputeAll(FIXED_NOW);
    expect(r.users).toBe(1);
    expect(r.picks).toBe(0);
    expect(m.pickCreateMany).not.toHaveBeenCalled();
  });

  it('自排除：邻居商品聚合永远不含自己的已购商品', async () => {
    // u1 与 u2 完全同买 [a,b] → sim=1，但邻居商品集 {a,b} ⊆ u1 已购 → 排除后无推荐
    mockMatrix([
      { user_id: 'u1', product_id: 'a' },
      { user_id: 'u1', product_id: 'b' },
      { user_id: 'u2', product_id: 'a' },
      { user_id: 'u2', product_id: 'b' },
    ]);
    const r = await svc.recomputeAll(FIXED_NOW);
    expect(r.picks).toBe(0);
  });

  it('事务物化：deleteMany 先于 createMany（失败旧批次保留语义）', async () => {
    mockMatrix([
      { user_id: 'u1', product_id: 'a' },
      { user_id: 'u2', product_id: 'a' },
      { user_id: 'u2', product_id: 'b' },
    ]);
    m.pickDeleteMany.mockResolvedValue({ count: 3 });
    m.pickCreateMany.mockResolvedValue({ count: 1 });
    await svc.recomputeAll(FIXED_NOW);
    expect(m.pickDeleteMany).toHaveBeenCalledBefore(m.pickCreateMany);
  });

  it('minSourceCount 可配：设 2 时单邻居证据商品不入库', async () => {
    m.systemConfigFindUnique.mockResolvedValue({
      key: 'recommendation.collaborative',
      value: JSON.stringify({ minSourceCount: 2 }),
    });
    // u1~u3 各自只与 u1 一个邻居交叉
    mockMatrix([
      { user_id: 'u1', product_id: 'a' },
      { user_id: 'u2', product_id: 'a' },
      { user_id: 'u2', product_id: 'b' },
      { user_id: 'u3', product_id: 'a' },
      { user_id: 'u3', product_id: 'c' },
    ]);
    const r = await svc.recomputeAll(FIXED_NOW);
    // u1 的候选 b/c 各只有 1 个邻居证据 < 2 → 全过滤
    const u1Rows = m.pickCreateMany.mock.calls[0]?.[0]?.data.filter(
      (p: { userId: string }) => p.userId === 'u1',
    ) ?? [];
    expect(r.picks).toBe(0);
    expect(u1Rows).toHaveLength(0);
  });
});

// ==================== 读路径（P6-2 / P6-4） ====================

describe('A9 物化读路径 getCustomersAlsoBought', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    service = new CatalogService({ recordSearch } as never, {
      getMaterializedPicks: vi.fn(),
    } as never);
    // assembleProductCards 依赖 batch 查询——stub 空即可（DTO 组装在 catalog.service.test 覆盖）
    m.skuFindMany.mockResolvedValue([]);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
  });

  it('P6-4 匿名（userId=null）→ 空数组不报错，不读物化', async () => {
    const r = await service.getCustomersAlsoBought(null, 6);
    expect(r).toEqual([]);
    expect(m.pickFindMany).not.toHaveBeenCalled();
  });

  it('P6-4 无物化结果 → 空数组（前端整块隐藏；勿用销量兜底——不触发销量查询）', async () => {
    const collab = {
      getMaterializedPicks: vi.fn().mockResolvedValue([]),
    };
    service = new CatalogService({ recordSearch } as never, collab as never);
    const r = await service.getCustomersAlsoBought('u1', 6);
    expect(r).toEqual([]);
    expect(collab.getMaterializedPicks).toHaveBeenCalledWith('u1', 6);
    // 红线：不回退销量榜
    expect(m.productFindMany).not.toHaveBeenCalled();
  });

  it('P6-2 正常：只读物化表（单查询）+ ACTIVE 过滤下架剔除不回填', async () => {
    const collab = {
      getMaterializedPicks: vi.fn().mockResolvedValue([
        { productId: 'p1', score: 0.8, sourceCount: 3, minScore: 0.4, computedAt: FIXED_NOW.toISOString() },
        { productId: 'p2', score: 0.5, sourceCount: 2, minScore: 0.3, computedAt: FIXED_NOW.toISOString() },
      ]),
    };
    service = new CatalogService({ recordSearch } as never, collab as never);
    // p1 下架（不出现在 product 查询结果）→ 只剩 p2
    m.productFindMany.mockResolvedValueOnce([
      { id: 'p2', shopId: 'shop-1', categoryId: null, name: { en: 'Rice' }, description: null, images: [], priceMin: 1000, salesCount: 5, status: 'ACTIVE', createdAt: FIXED_NOW, updatedAt: FIXED_NOW, skus: [] },
    ]);
    const r = await service.getCustomersAlsoBought('u1', 6);
    expect(r).toHaveLength(1);
    expect(r[0]!.id).toBe('p2');
    // 读物化不现算：协同过滤服务只有 findMany 物化读，无共现 SQL
    expect(m.queryRaw).not.toHaveBeenCalled();
  });
});

// ==================== getSimilarSignalMap per-user 口径（P3-1 裁决） ====================

describe('getSimilarSignalMap — per-user 信号（P3-1）', () => {
  const svc = new CollaborativeFilterService();

  it('SQL 带 user_id 参数化过滤（per-user 口径：当前用户自己的 picks 命中候选）', async () => {
    m.queryRaw.mockResolvedValueOnce([{ product_id: 'p1', signal: 0.5 }]);
    const r = await svc.getSimilarSignalMap('user-A', ['p1', 'p2']);
    expect(r.get('p1')).toBe(0.5);
    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain('user_id =');
    expect(m.queryRaw.mock.calls[0]![1]).toBe('user-A'); // 参数化 userId
  });

  it('匿名（userId=null）→ 空 Map 不查库（安全降级）', async () => {
    const r = await svc.getSimilarSignalMap(null, ['p1']);
    expect(r.size).toBe(0);
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it('候选空数组 → 空 Map 不查库', async () => {
    const r = await svc.getSimilarSignalMap('user-A', []);
    expect(r.size).toBe(0);
    expect(m.queryRaw).not.toHaveBeenCalled();
  });

  it('该用户无 picks（SQL 空）→ 空 Map 降级', async () => {
    m.queryRaw.mockResolvedValueOnce([]);
    const r = await svc.getSimilarSignalMap('user-A', ['p1']);
    expect(r.size).toBe(0);
  });
});

// ==================== B7 开关两态（P6-3 回归红线） ====================

describe('B7 开关两态（批6 接管）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);
  const collabStub = {
    getMaterializedPicks: vi.fn().mockResolvedValue([]),
    getSimilarSignalMap: vi.fn().mockResolvedValue(new Map()),
  };

  beforeEach(() => {
    service = new CatalogService({ recordSearch } as never, collabStub as never);
    m.skuFindMany.mockResolvedValue([]);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.systemConfigFindUnique.mockResolvedValue(null);
  });

  /** 固定加权场景（与 catalog.frequent-bundle.test.ts 同款） */
  const productRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    shopId: 'shop-1',
    categoryId: null,
    name: { en: 'Milk' },
    description: null,
    images: [],
    priceMin: 1000,
    salesCount: 10,
    status: 'ACTIVE',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    skus: [],
    ...overrides,
  });

  const setupWeighted = () => {
    m.queryRaw.mockResolvedValueOnce([
      { product_id: 'prod-h1', freq: 3n, category_id: 'cat-1' },
      { product_id: 'prod-h2', freq: 1n, category_id: 'cat-2' },
    ]);
    m.productFindMany
      .mockResolvedValueOnce([productRow('prod-h1', { categoryId: 'cat-1' })])
      .mockResolvedValueOnce([
        productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 }),
        productRow('prod-s2', { categoryId: 'cat-2', salesCount: 400 }),
      ])
      .mockResolvedValueOnce([]);
  };

  it('P6-3 开关 OFF（默认）：类目加权序照常 + 协同过滤零调用（不触融合路径）', async () => {
    setupWeighted();
    const result = await service.getRecommendations('user-A', 6);
    expect(result.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
    expect(collabStub.getSimilarSignalMap).not.toHaveBeenCalled();
  });

  it('P6-3 开关 ON + b7SimilarWeight=0：融合分等价类目加权序（逐字节一致回归）', async () => {
    m.systemConfigFindUnique.mockImplementation((args: { where: { key: string } }) => {
      if (args.where.key === 'recommendation.personalRankingEnabled') {
        return Promise.resolve({ key: args.where.key, value: 'true' });
      }
      // collaborative 配置：权重 0
      return Promise.resolve({
        key: args.where.key,
        value: JSON.stringify({ b7SimilarWeight: 0 }),
      });
    });
    setupWeighted();
    const onResult = await service.getRecommendations('user-A', 6);

    resetRecommendationConfigCacheForTest();
    resetCollaborativeConfigCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null);
    setupWeighted();
    const offResult = await service.getRecommendations('user-A', 6);

    expect(onResult).toEqual(offResult);
    expect(onResult.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
  });

  it('开关 ON + 相似信号 → 融合排序生效（信号强的候选上位）', async () => {
    m.systemConfigFindUnique.mockImplementation((args: { where: { key: string } }) => {
      if (args.where.key === 'recommendation.personalRankingEnabled') {
        return Promise.resolve({ key: args.where.key, value: 'true' });
      }
      return Promise.resolve({
        key: args.where.key,
        value: JSON.stringify({ b7SimilarWeight: 0.9 }),
      });
    });
    setupWeighted();
    // 信号：末位 prod-s2 拿满信号 1.0，其余 0 → 融合后 s2 应上位（per-user 口径 P3-1）
    collabStub.getSimilarSignalMap.mockResolvedValue(
      new Map([
        ['prod-s1', 0],
        ['prod-s2', 1],
      ]),
    );
    const result = await service.getRecommendations('user-A', 6);
    expect(collabStub.getSimilarSignalMap).toHaveBeenCalledWith(
      'user-A',
      expect.arrayContaining(['prod-h1', 'prod-s1', 'prod-s2']),
    );
    expect(result.map((r) => r.id)).toEqual(['prod-s2', 'prod-h1', 'prod-s1']);
  });

  it('开关 ON + 无物化数据 → 安全降级纯类目加权序（不炸）', async () => {
    m.systemConfigFindUnique.mockResolvedValue({
      key: 'recommendation.personalRankingEnabled',
      value: 'true',
    });
    setupWeighted();
    collabStub.getSimilarSignalMap.mockResolvedValue(new Map());
    const result = await service.getRecommendations('user-A', 6);
    expect(result.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
  });
});
