/**
 * 批3 后端单测（客户画像批3 2026-10-18）
 *
 * 覆盖任务书验收线：
 *   1. B8 frequent-bundle 共现口径：
 *      - 匿名（userId=null）→ 空组合，零 SQL
 *      - 无历史（聚合空）→ 空组合
 *      - 无共现（seed 有但伙伴空）→ 空组合
 *      - 正常组合：seed=频次最高；items 按共现订单数 desc；coOrderCount=top1 伙伴共现数
 *      - 口径红线：两条 SQL 均 status IN ('COMPLETED','CANCELLED') 且不过滤 deleted_at
 *      - ACTIVE 过滤：seed 下架 → 空组合；伙伴部分下架剔除不回填
 *      - limit clamp：controller -1→默认 5 / 100→10
 *   2. B7 开关（裁决：预留总闸，OFF=ON=现状行为不变）：
 *      - parse 回退三态：null/非法 JSON/非布尔 → false
 *      - 默认关：DB 无配置 → false（回归红线锚点）
 *      - 对象形态 {"personalRankingEnabled":true} → true
 *      - getRecommendations 开关 ON/OFF 排序行为逐字节一致（预留总闸语义回归断言）
 *   3. OptionalAuth 三态（controller 元数据 + guard 行为，范式同 catalog.buy-again.test.ts）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  skuFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  stockFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  queryRaw: vi.fn(),
  redisGet: vi.fn(),
  redisIncr: vi.fn(),
  setWithTTL: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    product: { findMany: m.productFindMany },
    sku: { findMany: m.skuFindMany },
    category: { findMany: m.categoryFindMany },
    stock: { findMany: m.stockFindMany },
    review: { groupBy: m.reviewGroupBy },
    $queryRaw: m.queryRaw,
    systemConfig: { findUnique: m.systemConfigFindUnique },
  },
}));

vi.mock('../src/shared/cache/redis', () => ({
  redis: { get: m.redisGet, incr: m.redisIncr },
  setWithTTL: m.setWithTTL,
}));

vi.mock('../src/shared/logger/logger', () => ({
  logger: { warn: m.loggerWarn, info: vi.fn(), error: vi.fn() },
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';
import { ClientProductController } from '../src/modules/catalog/catalog.controller';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { Reflector } from '@nestjs/core';
import {
  parsePersonalRankingEnabled,
  getPersonalRankingEnabled,
  resetRecommendationConfigCacheForTest,
  PERSONAL_RANKING_ENABLED_DEFAULT,
  PERSONAL_RANKING_ENABLED_KEY,
} from '../src/modules/catalog/recommendation.config';

// $queryRaw 是 tagged template，mock 按调用序依次返回
const mockQuery = <T>(rows: T[]) => {
  m.queryRaw.mockResolvedValueOnce(rows);
};

const productRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  shopId: 'shop-1',
  categoryId: null,
  name: { en: 'Milk' },
  description: null,
  mainImage: 'milk.png',
  images: [],
  status: 'ACTIVE',
  unit: { en: 'bag' },
  priceMin: 1500,
  salesCount: 100,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  ...overrides,
});

/** 组装卡片最小 mock：stock/review/category 空 + top3 空 */
function stubAssemble() {
  m.stockFindMany.mockResolvedValue([]);
  m.reviewGroupBy.mockResolvedValue([]);
  m.categoryFindMany.mockResolvedValue([]);
  m.skuFindMany.mockResolvedValue([]);
}

// ============================================================================
// 1. B8 frequent-bundle 共现口径
// ============================================================================

describe('CatalogService.getFrequentBundle — 共现口径（B8）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch } as never);
    stubAssemble();
  });

  it('匿名（userId=null）：空组合，零 SQL（无聚合放大）', async () => {
    const result = await service.getFrequentBundle(null, 5);

    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(result).toEqual({ seed: null, items: [], coOrderCount: 0 });
  });

  it('无历史（seed 聚合空）：空组合', async () => {
    mockQuery([]); // seed 聚合空

    const result = await service.getFrequentBundle('user-A', 5);

    expect(result).toEqual({ seed: null, items: [], coOrderCount: 0 });
    // 第 2 查不发出
    expect(m.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('有 seed 无共现（伙伴聚合空）：空组合', async () => {
    mockQuery([{ product_id: 'seed-1', freq: 3n, last_at: new Date('2026-01-05') }]);
    mockQuery([]); // 共现空

    const result = await service.getFrequentBundle('user-A', 5);

    expect(result).toEqual({ seed: null, items: [], coOrderCount: 0 });
  });

  it('正常组合：seed=频次最高；items 按共现订单数 desc；coOrderCount=top1 伙伴共现数', async () => {
    mockQuery([{ product_id: 'seed-1', freq: 9n, last_at: new Date('2026-01-05') }]);
    mockQuery([
      { product_id: 'p-b', co_order_count: 5n, last_at: new Date('2026-01-04') },
      { product_id: 'p-a', co_order_count: 2n, last_at: new Date('2026-01-06') },
    ]);
    m.productFindMany.mockResolvedValueOnce([
      productRow('seed-1'),
      productRow('p-b'),
      productRow('p-a'),
    ]);

    const result = await service.getFrequentBundle('user-A', 5);

    expect(result.seed).toMatchObject({ id: 'seed-1' });
    // 保持共现 SQL 排序（p-b 5 单在前），不重排
    expect(result.items.map((i) => i.id)).toEqual(['p-b', 'p-a']);
    expect(result.coOrderCount).toBe(5);
  });

  it('口径红线：两条 SQL 均 COMPLETED+CANCELLED 字面量、不过滤 deleted_at（R-a 同源）', async () => {
    mockQuery([]);
    await service.getFrequentBundle('user-A', 5);

    const seedSql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(seedSql).toContain("'COMPLETED', 'CANCELLED'");
    expect(seedSql).not.toContain('deleted_at');
    expect(seedSql).toContain('ORDER BY freq DESC, last_at DESC');
  });

  it('共现 SQL：排除 seed 自身（oi2.product_id <> oi1.product_id）+ 用户隔离（user_id 参数）', async () => {
    mockQuery([{ product_id: 'seed-1', freq: 3n, last_at: new Date() }]);
    mockQuery([]);
    await service.getFrequentBundle('user-A', 5);

    const coSql: string = m.queryRaw.mock.calls[1]![0].join('');
    expect(coSql).toContain('<>');
    // tagged template 参数：[strings, userId, seedId, limit]
    expect(m.queryRaw.mock.calls[1]![1]).toBe('user-A');
    expect(m.queryRaw.mock.calls[1]![2]).toBe('seed-1');
    expect(m.queryRaw.mock.calls[1]![3]).toBe(5);
  });

  it('ACTIVE 过滤：seed 下架 → 空组合（不回填不退化）', async () => {
    mockQuery([{ product_id: 'seed-1', freq: 3n, last_at: new Date() }]);
    mockQuery([{ product_id: 'p-b', co_order_count: 2n, last_at: new Date() }]);
    // DB 只回伙伴（seed 已下架被过滤）
    m.productFindMany.mockResolvedValueOnce([productRow('p-b')]);

    const result = await service.getFrequentBundle('user-A', 5);

    expect(result).toEqual({ seed: null, items: [], coOrderCount: 0 });
  });

  it('ACTIVE 过滤：伙伴部分下架剔除不回填，where 含 status ACTIVE', async () => {
    mockQuery([{ product_id: 'seed-1', freq: 3n, last_at: new Date() }]);
    mockQuery([
      { product_id: 'p-b', co_order_count: 5n, last_at: new Date() },
      { product_id: 'p-a', co_order_count: 2n, last_at: new Date() },
    ]);
    // DB 过滤掉 p-a（下架）
    m.productFindMany.mockResolvedValueOnce([productRow('seed-1'), productRow('p-b')]);

    const result = await service.getFrequentBundle('user-A', 5);

    expect(m.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['seed-1', 'p-b', 'p-a'] }, status: 'ACTIVE' },
      }),
    );
    expect(result.items.map((i) => i.id)).toEqual(['p-b']);
  });

  it('controller 注入 sub：queryRaw 第 1 参数是 req.user.sub', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-1', role: 'CUSTOMER', deviceType: 'client_app' } };
    mockQuery([{ product_id: 'seed-1', freq: 1n, last_at: new Date() }]);
    mockQuery([{ product_id: 'p-b', co_order_count: 1n, last_at: new Date() }]);
    m.productFindMany.mockResolvedValue([productRow('seed-1'), productRow('p-b')]);

    await controller.frequentBundle(undefined, req);

    expect(m.queryRaw.mock.calls[0]![1]).toBe('user-sub-1');
  });

  it('controller limit clamp：-1→默认 5 / 100→10 / 合法 3→3', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-2', role: 'CUSTOMER', deviceType: 'client_app' } };

    // -1 → 兜底默认 5（queryRaw 第 3 参数）
    mockQuery([{ product_id: 's', freq: 1n, last_at: new Date() }]);
    mockQuery([]);
    await controller.frequentBundle('-1', req);
    expect(m.queryRaw.mock.calls.at(-1)![3]).toBe(5);

    // 100 → clamp 10
    mockQuery([{ product_id: 's', freq: 1n, last_at: new Date() }]);
    mockQuery([]);
    await controller.frequentBundle('100', req);
    expect(m.queryRaw.mock.calls.at(-1)![3]).toBe(10);

    // 合法 3 透传
    mockQuery([{ product_id: 's', freq: 1n, last_at: new Date() }]);
    mockQuery([]);
    await controller.frequentBundle('3', req);
    expect(m.queryRaw.mock.calls.at(-1)![3]).toBe(3);
  });
});

// ============================================================================
// 2. B7 开关（预留总闸：默认关 + OFF=ON 行为一致）
// ============================================================================

describe('parsePersonalRankingEnabled — 解析回退（B7）', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRecommendationConfigCacheForTest();
  });

  it('null/undefined/空串 → 默认 false（fail-safe 默认关）', () => {
    expect(parsePersonalRankingEnabled(null)).toBe(false);
    expect(parsePersonalRankingEnabled(undefined)).toBe(false);
    expect(parsePersonalRankingEnabled('')).toBe(false);
    expect(PERSONAL_RANKING_ENABLED_DEFAULT).toBe(false);
  });

  it('非法 JSON → 回退 false + 告警', () => {
    expect(parsePersonalRankingEnabled('{not json')).toBe(false);
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'PERSONAL_RANKING_PARSE_FALLBACK' }),
    );
  });

  it('非布尔非对象形态（数字/字符串/对象缺字段）→ 回退 false', () => {
    expect(parsePersonalRankingEnabled('1')).toBe(false);
    expect(parsePersonalRankingEnabled('"true"')).toBe(false);
    expect(parsePersonalRankingEnabled('{"other":true}')).toBe(false);
    expect(parsePersonalRankingEnabled('{"personalRankingEnabled":"yes"}')).toBe(false);
  });

  it('裸布尔 true / 对象 {"personalRankingEnabled":true} → true（两种形态兼容）', () => {
    expect(parsePersonalRankingEnabled('true')).toBe(true);
    expect(parsePersonalRankingEnabled('{"personalRankingEnabled":true}')).toBe(true);
    expect(parsePersonalRankingEnabled('{"personalRankingEnabled":false}')).toBe(false);
  });
});

describe('getPersonalRankingEnabled — DB 读取', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetRecommendationConfigCacheForTest();
  });

  it('DB 无配置 → false（回归红线锚点：默认关）', async () => {
    m.systemConfigFindUnique.mockResolvedValue(null);

    expect(await getPersonalRankingEnabled()).toBe(false);
    expect(m.systemConfigFindUnique).toHaveBeenCalledWith({
      where: { key: PERSONAL_RANKING_ENABLED_KEY },
    });
  });

  it('DB 异常 → 降级 false 不炸（只读配置）', async () => {
    m.systemConfigFindUnique.mockRejectedValue(new Error('db down'));

    expect(await getPersonalRankingEnabled()).toBe(false);
    expect(m.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'PERSONAL_RANKING_DB_DEGRADED' }),
    );
  });

  it('配置 true → true（批6 预留位可翻转）', async () => {
    m.systemConfigFindUnique.mockResolvedValue({ key: PERSONAL_RANKING_ENABLED_KEY, value: 'true' });

    expect(await getPersonalRankingEnabled()).toBe(true);
  });
});

describe('B7 预留总闸回归断言：OFF=ON 排序行为逐字节一致', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    resetRecommendationConfigCacheForTest();
    service = new CatalogService({ recordSearch } as never);
    stubAssemble();
    m.skuFindMany.mockResolvedValue([]);
    m.systemConfigFindUnique.mockResolvedValue(null);
  });

  /** 固定加权场景（与 catalog.buy-again.test.ts「加权生效」用例同款）：历史 h1(cat-1)>h2(cat-2) + 类目池 s1/s2 */
  const setupWeighted = () => {
    m.queryRaw.mockResolvedValueOnce([
      { product_id: 'prod-h1', freq: 3n, category_id: 'cat-1' },
      { product_id: 'prod-h2', freq: 1n, category_id: 'cat-2' },
    ]);
    m.productFindMany
      .mockResolvedValueOnce([productRow('prod-h1', { categoryId: 'cat-1' })]) // h2 已下架被剔
      .mockResolvedValueOnce([
        productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 }),
        productRow('prod-s2', { categoryId: 'cat-2', salesCount: 400 }),
      ])
      .mockResolvedValueOnce([]);
  };

  it('开关 OFF（默认）：加权路径照常生效（=3c05738 现状）', async () => {
    setupWeighted();
    const result = await service.getRecommendations('user-A', 6);
    expect(result.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
  });

  it('开关 ON：行为与 OFF 逐字节一致（本批零分支——预留总闸语义）', async () => {
    m.systemConfigFindUnique.mockResolvedValue({
      key: PERSONAL_RANKING_ENABLED_KEY,
      value: 'true',
    });
    setupWeighted();
    const onResult = await service.getRecommendations('user-A', 6);

    resetRecommendationConfigCacheForTest();
    m.systemConfigFindUnique.mockResolvedValue(null);
    setupWeighted();
    const offResult = await service.getRecommendations('user-A', 6);

    expect(onResult).toEqual(offResult);
    expect(onResult.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
  });

  it('开关读取不改变匿名回退路径（不查个性化聚合，销量 top N 逐参数一致）', async () => {
    m.productFindMany.mockResolvedValueOnce([productRow('top-1')]);

    const result = await service.getRecommendations(null, 6);

    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.productFindMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      take: 6,
      skip: 0,
    });
    expect(result[0]!.id).toBe('top-1');
  });
});

// ============================================================================
// 3. OptionalAuth 三态（frequent-bundle 端点，范式同 catalog.buy-again.test.ts）
// ============================================================================

describe('frequent-bundle OptionalAuth 三态', () => {
  const makeContext = (metadata: Record<string, unknown>, handlerUser?: unknown) => {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);
    const request = { user: handlerUser, headers: {} };
    return {
      guard,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ({}),
        getClass: () => ({}),
      } as never,
    };
  };

  it('元数据声明：@OptionalAuth 存在（optionalAuth=true）', () => {
    // handler 级装饰器（getAllAndOverride handler 优先）
    const reflector = {
      getAllAndOverride: (key: string) => (key === 'optionalAuth' ? true : undefined),
    } as unknown as Reflector;
    // ClientProductController 类级 @Public()，方法级 @OptionalAuth 覆盖
    expect(
      reflector.getAllAndOverride('optionalAuth', [
        ClientProductController.prototype.frequentBundle,
        ClientProductController,
      ]),
    ).toBe(true);
  });

  it('三态之一：无 token → 降级匿名返回 true（不 401）', async () => {
    const { guard, context } = makeContext({ optionalAuth: true });
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockRejectedValueOnce(
      new UnauthorizedException(),
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('三态之二：有效 token → user 注入返回 true', async () => {
    const user = { sub: 'u1', role: 'CUSTOMER', deviceType: 'client_app' };
    const { guard, context } = makeContext({ optionalAuth: true }, user);
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockResolvedValueOnce(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('三态之三：非 optional 路由无 token → 仍 401（零变化）', async () => {
    const { guard, context } = makeContext({});
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockRejectedValueOnce(
      new UnauthorizedException({ code: 'E-AUTH-002' }),
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
