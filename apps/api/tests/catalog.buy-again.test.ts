/**
 * buy-again per-user 化测试（个性化推荐批1 2026-10-17）+ OptionalAuth guard + 热搜 userId 顺手修
 *
 * 覆盖任务书验收线 B2：
 * - 用户隔离（A 历史不串 B）/ 空历史回退 / 未登录回退（销量 7~12 切片）
 * - CANCELLED 纳入 / 软删订单纳入（v2 拍板不过滤 deletedAt）/ 非 ACTIVE 过滤
 * - 频次优先，同次数时间次之
 * - 无效 token 匿名不 401（guard optional 分支）/ 未标记路由仍 401（零变化）
 * - 热搜记录带 userId（listProducts/search 取 sub 的 v2 第 7 条配套）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  productCount: vi.fn(),
  skuFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
  stockFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  queryRaw: vi.fn(),
  redisGet: vi.fn(),
  redisIncr: vi.fn(),
  setWithTTL: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    product: { findMany: m.productFindMany, count: m.productCount },
    sku: { findMany: m.skuFindMany },
    category: { findMany: m.categoryFindMany },
    stock: { findMany: m.stockFindMany },
    review: { groupBy: m.reviewGroupBy },
    $queryRaw: m.queryRaw,
  },
}));

vi.mock('../src/shared/cache/redis', () => ({
  redis: { get: m.redisGet, incr: m.redisIncr },
  setWithTTL: m.setWithTTL,
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';
import { JwtAuthGuard } from '../src/shared/guards/jwt-auth.guard';
import { ClientProductController } from '../src/modules/catalog/catalog.controller';
import { Reflector } from '@nestjs/core';

// $queryRaw 是 tagged template，mock 按 (strings, ...params) 收参
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

describe('CatalogService.getBuyAgain（per-user 化）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch } as never);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.redisGet.mockResolvedValue(null);
  });

  it('用户隔离：where 含 user_id 参数（A 的历史不串 B）', async () => {
    mockQuery([{ product_id: 'prod-a', freq: 2n, last_at: new Date('2026-01-05') }]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-a')]);
    m.skuFindMany.mockResolvedValueOnce([]);

    await service.getBuyAgain('user-A', 6);

    // tagged template 参数第 1 位（strings 后）是 userId
    expect(m.queryRaw.mock.calls[0]![1]).toBe('user-A');
  });

  it('CANCELLED 纳入 + 软删订单纳入（不过滤 deletedAt）', async () => {
    mockQuery([{ product_id: 'prod-x', freq: 3n, last_at: new Date('2026-01-05') }]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-x')]);
    m.skuFindMany.mockResolvedValueOnce([]);

    const result = await service.getBuyAgain('user-A', 6);

    // SQL 文本含 CANCELLED 且不含 deleted_at 过滤
    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain('CANCELLED');
    expect(sql).not.toContain('deleted_at');
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('prod-x');
  });

  it('频次优先，同次数时间次之（SQL ORDER BY 锁定）', async () => {
    mockQuery([]); // 聚合空 → 走回退
    m.productFindMany.mockResolvedValueOnce([]); // 回退切片空

    await service.getBuyAgain('user-A', 6);

    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain('ORDER BY freq DESC, last_at DESC');
  });

  it('有历史：按聚合顺序返回 + 非 ACTIVE 过滤（剔除后不回填）', async () => {
    // 聚合序 prod-1(频次高) -> prod-2；DB where status=ACTIVE 只回 prod-1（模拟 DB 过滤掉 INACTIVE）
    mockQuery([
      { product_id: 'prod-1', freq: 5n, last_at: new Date('2026-01-05') },
      { product_id: 'prod-2', freq: 2n, last_at: new Date('2026-01-04') },
    ]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-1')]);
    m.skuFindMany.mockResolvedValueOnce([]);

    const result = await service.getBuyAgain('user-A', 6);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('prod-1');
    // ACTIVE 过滤走 where status（二次过滤在 DB）
    expect(m.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['prod-1', 'prod-2'] }, status: 'ACTIVE' } }),
    );
  });

  it('空历史：回退销量第 limit+1~2*limit 切片（skip limit, take limit）', async () => {
    mockQuery([]); // 用户聚合空
    const slice = [productRow('slice-7'), productRow('slice-8')];
    m.productFindMany.mockResolvedValueOnce(slice);
    m.skuFindMany.mockResolvedValueOnce([]);

    const result = await service.getBuyAgain('user-A', 6);

    expect(m.queryRaw).toHaveBeenCalledTimes(1);
    expect(m.productFindMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      skip: 6,
      take: 6,
    });
    expect(result.map((r) => r.id)).toEqual(['slice-7', 'slice-8']);
  });

  it('未登录（userId=null）：不查聚合，直接回退切片', async () => {
    m.productFindMany.mockResolvedValueOnce([productRow('slice-x')]);
    m.skuFindMany.mockResolvedValueOnce([]);

    const result = await service.getBuyAgain(null, 6);

    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('slice-x');
  });

  it('DTO 结构与 getRecommendations 完全一致（字段集合 + 值形态）', async () => {
    mockQuery([{ product_id: 'prod-1', freq: 1n, last_at: new Date() }]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-1', { salesCount: 7 })]);
    m.skuFindMany.mockResolvedValueOnce([{ id: 'sku-1', productId: 'prod-1' }]);

    const buyAgain = await service.getBuyAgain('user-A', 6);

    m.productFindMany.mockResolvedValueOnce([productRow('prod-1', { salesCount: 7 })]);
    m.skuFindMany.mockResolvedValueOnce([{ id: 'sku-1', productId: 'prod-1' }]);
    const rec = await service.getRecommendations(null, 6);

    expect(Object.keys(buyAgain[0]!).sort()).toEqual(Object.keys(rec[0]!).sort());
    expect(buyAgain[0]).toMatchObject({ id: 'prod-1', defaultSkuId: 'sku-1', salesCount: 7 });
    expect(typeof buyAgain[0]!.createdAt).toBe('string');
  });
});

// ===== v2 第 7 条：热搜记录带 userId（listProducts 取 req.user.sub）=====

describe('热搜记录 userId（顺手修 id→sub）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch } as never);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.redisGet.mockResolvedValue(null);
    m.skuFindMany.mockResolvedValue([]);
  });

  it('listProducts keyword 搜索：recordSearch 收到 userId（service 层透传）', async () => {
    m.queryRaw.mockResolvedValueOnce([{ id: 'prod-1' }]);
    m.productFindMany.mockResolvedValueOnce([]);
    m.productCount.mockResolvedValueOnce(0);

    await service.listProducts({ keyword: 'milk', lang: 'en', userId: 'user-A', clientIp: '1.2.3.4' });

    expect(recordSearch).toHaveBeenCalledWith('milk', 'en', 'user-A', 0, '1.2.3.4');
  });

  it('controller list/search 取 req.user.sub（非 id——RequestUser 无 id 字段）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-1', role: 'CUSTOMER', deviceType: 'client_app' }, headers: {}, ip: '1.2.3.4' };
    m.productFindMany.mockResolvedValue([]);
    m.productCount.mockResolvedValue(0);
    m.queryRaw.mockResolvedValue([{ id: 'prod-1' }]);

    // list(categoryId, keyword, page, pageSize, sortBy, acceptLang, req)
    await controller.list(undefined, 'milk', undefined, undefined, undefined, 'en', req);
    expect(recordSearch.mock.calls.at(-1)![2]).toBe('user-sub-1');

    // search(keyword, page, sortBy, acceptLang, req)
    await controller.search('milk', undefined, undefined, 'en', req);
    expect(recordSearch.mock.calls.at(-1)![2]).toBe('user-sub-1');
  });

  it('controller buy-again 注入 sub + 默认 limit（@Req 注入路径）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-2', role: 'CUSTOMER', deviceType: 'client_app' } };
    mockQuery([{ product_id: 'prod-1', freq: 1n, last_at: new Date() }]);
    m.productFindMany.mockResolvedValue([productRow('prod-1')]);
    m.skuFindMany.mockResolvedValue([]);

    // 批1 换一批：controller 签名插入 offset（第 2 参），旧行为 offset=undefined→0
    const result = await controller.buyAgain(undefined, undefined, req);

    expect(m.queryRaw.mock.calls[0]![1]).toBe('user-sub-2');
    expect(result).toMatchObject({ success: true });
  });

  // ===== 审查 P2-1：limit clamp 1~20（对齐 suggest R2 先例），负值/NaN 兜底默认 6 =====

  it('P2-1 clamp：limit=-1 → 兜底默认 6（service 收到 6，非负值 500）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-3', role: 'CUSTOMER', deviceType: 'client_app' } };
    mockQuery([]); // 聚合空
    m.productFindMany.mockResolvedValueOnce([]);
    m.skuFindMany.mockResolvedValue([]);

    await controller.buyAgain('-1', req);

    // 回退切片以默认 limit=6 调用（skip 6, take 6）
    expect(m.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 6, take: 6 }),
    );
  });

  it('P2-1 clamp：limit=1000 → clamp 到 20（service 收到 20）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-3', role: 'CUSTOMER', deviceType: 'client_app' } };
    mockQuery([]); // 聚合空
    m.productFindMany.mockResolvedValueOnce([]);
    m.skuFindMany.mockResolvedValue([]);

    await controller.buyAgain('1000', req);

    expect(m.productFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
});

// ===== 批2：recommendations 类目偏好加权（R1）=====

describe('CatalogService.getRecommendations（类目偏好加权）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch } as never);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.redisGet.mockResolvedValue(null);
    m.skuFindMany.mockResolvedValue([]);
  });

  it('未登录（userId=null）：退化为销量 top N，不查聚合（旧行为逐参数一致）', async () => {
    m.productFindMany.mockResolvedValueOnce([productRow('top-1')]);

    const result = await service.getRecommendations(null, 6);

    expect(m.queryRaw).not.toHaveBeenCalled();
    // 批1 换一批：回退路径加 skip: offset，offset 默认 0 与旧行为逐参数一致
    expect(m.productFindMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      take: 6,
      skip: 0,
    });
    expect(result[0]!.id).toBe('top-1');
  });

  it('无历史（聚合空）：退化为销量 top N', async () => {
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([productRow('top-2')]);

    const result = await service.getRecommendations('user-A', 6);

    expect(m.queryRaw).toHaveBeenCalledTimes(1);
    expect(result[0]!.id).toBe('top-2');
  });

  it('加权生效：历史商品（频次序）优先，同类目高销量补足排后', async () => {
    // 用户历史：prod-h1(freq 3, cat-1) > prod-h2(freq 1, cat-2)
    mockQuery([
      { product_id: 'prod-h1', freq: 3n, category_id: 'cat-1' },
      { product_id: 'prod-h2', freq: 1n, category_id: 'cat-2' },
    ]);
    m.productFindMany
      // 第 1 次：历史商品 ACTIVE 过滤（h1 活跃，h2 已下架被剔）
      .mockResolvedValueOnce([productRow('prod-h1', { categoryId: 'cat-1' })])
      // 第 2 次：偏好类目池（高销量候选）
      .mockResolvedValueOnce([
        productRow('prod-s1', { categoryId: 'cat-1', salesCount: 500 }),
        productRow('prod-s2', { categoryId: 'cat-2', salesCount: 400 }),
      ])
      // 第 3 次：getCategoryTop3ProductIds 徽章查询（cat-1/cat-2）
      .mockResolvedValueOnce([
        { id: 'prod-h1', categoryId: 'cat-1' },
        { id: 'prod-s1', categoryId: 'cat-1' },
        { id: 'prod-s2', categoryId: 'cat-2' },
      ]);

    const result = await service.getRecommendations('user-A', 6);

    // 历史活跃在前 → 同类目（cat-1 优先于 cat-2 的偏好顺序）高销量续排
    expect(result.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2']);
  });

  it('软删口径：SQL 不过滤 deleted_at（复用批1聚合口径，v2 拍板买过就算）', async () => {
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);

    await service.getRecommendations('user-A', 6);

    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain("'COMPLETED', 'CANCELLED'");
    expect(sql).not.toContain('deleted_at');
  });

  it('P3-1 tiebreak：聚合 SQL ORDER BY 含 last_at 次序（对齐批1 buy-again 口径）', async () => {
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);

    await service.getRecommendations('user-A', 6);

    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain('MAX(o.created_at) AS last_at');
    expect(sql).toContain('ORDER BY freq DESC, last_at DESC');
  });

  it('非 ACTIVE 过滤：历史商品全下架但类目池有货 → 类目池商品透传（P3-3）', async () => {
    mockQuery([{ product_id: 'prod-dead', freq: 2n, category_id: 'cat-1' }]);
    m.productFindMany
      .mockResolvedValueOnce([]) // 历史商品 ACTIVE 过滤后空（全下架）
      .mockResolvedValueOnce([productRow('pool-1', { categoryId: 'cat-1' })]) // 类目池有 1 条
      .mockResolvedValueOnce([]); // top3 徽章查询

    const result = await service.getRecommendations('user-A', 6);

    // 历史全下架 → 同类目池商品透传（不退化、不空窗）
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('pool-1');
  });

  it('controller recommendations 注入 sub + limit clamp（-1→默认 6，1000→20）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-9', role: 'CUSTOMER', deviceType: 'client_app' } };
    m.productFindMany.mockResolvedValue([]);
    m.queryRaw.mockResolvedValue([]);

    await controller.recommendations('-1', req);
    // -1 兜底默认 6 → 未登录/空聚合退化 top N 路径（take 6）
    expect(m.productFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 6 }),
    );

    await controller.recommendations('1000', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ take: 20 }),
    );

    // sub 透传：带历史路径 queryRaw 第 1 参数（strings 后）是 userId
    mockQuery([{ product_id: 'prod-h1', freq: 1n, category_id: 'cat-1' }]);
    m.productFindMany.mockReset();
    m.productFindMany
      .mockResolvedValueOnce([productRow('prod-h1')]) // 历史商品
      .mockResolvedValueOnce([]) // 类目池
      .mockResolvedValueOnce([]); // top3 徽章
    await controller.recommendations(undefined, undefined, req);
    expect(m.queryRaw.mock.calls.at(-1)![1]).toBe('user-sub-9');
  });
});

// ===== 换一批按钮 批1：offset 翻页（2026-10-17）=====

describe('offset 翻页（换一批按钮 批1）', () => {
  let service: CatalogService;
  const recordSearch = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch } as never);
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
    m.redisGet.mockResolvedValue(null);
    m.skuFindMany.mockResolvedValue([]);
  });

  it('getBuyAgain offset=0 回归：SQL 含 OFFSET 0 参数、回退 skip 6（逐参数与现状一致）', async () => {
    mockQuery([{ product_id: 'prod-1', freq: 1n, last_at: new Date() }]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-1')]);

    await service.getBuyAgain('user-A', 6, 0);

    // tagged template 参数：strings 后依次 userId, limit, offset
    expect(m.queryRaw.mock.calls[0]![1]).toBe('user-A');
    expect(m.queryRaw.mock.calls[0]![2]).toBe(6);
    expect(m.queryRaw.mock.calls[0]![3]).toBe(0);
    const sql: string = m.queryRaw.mock.calls[0]![0].join('');
    expect(sql).toContain('OFFSET');

    // offset=0 回退路径：skip = limit + 0 = 6（旧行为）
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await service.getBuyAgain('user-A', 6, 0);
    expect(m.productFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 6, take: 6 }),
    );
  });

  it('getBuyAgain offset=limit：SQL OFFSET 6，第二批与第一批不重叠（回退 skip 12）', async () => {
    mockQuery([{ product_id: 'prod-b1', freq: 1n, last_at: new Date() }]);
    m.productFindMany.mockResolvedValueOnce([productRow('prod-b1')]);

    await service.getBuyAgain('user-A', 6, 6);

    expect(m.queryRaw.mock.calls[0]![3]).toBe(6);
    expect(m.queryRaw.mock.calls[0]![2]).toBe(6);

    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await service.getBuyAgain('user-A', 6, 6);
    // 回退：skip = limit + offset = 12（第二批避开回退第一屏 6 名）
    expect(m.productFindMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 12, take: 6 }),
    );
  });

  it('getRecommendations 个性化路径：offset 内存切片（offset=6 取候选第 7~12 名）', async () => {
    const setupHistory = () => {
      // 历史商品 prod-h1 + 类目池 prod-s1..s7 → 有序候选 = [h1, s1..s7]
      mockQuery([{ product_id: 'prod-h1', freq: 3n, category_id: 'cat-1' }]);
      m.productFindMany
        .mockResolvedValueOnce([productRow('prod-h1', { categoryId: 'cat-1' })]) // 历史商品
        .mockResolvedValueOnce(
          ['s1', 's2', 's3', 's4', 's5', 's6', 's7'].map((id) =>
            productRow(`prod-${id}`, { categoryId: 'cat-1', salesCount: 100 }),
          ),
        ) // 类目池
        .mockResolvedValueOnce([]); // top3 徽章
    };

    setupHistory();
    const first = await service.getRecommendations('user-A', 6, 0);
    expect(first.map((r) => r.id)).toEqual(['prod-h1', 'prod-s1', 'prod-s2', 'prod-s3', 'prod-s4', 'prod-s5']);

    setupHistory();
    const second = await service.getRecommendations('user-A', 6, 6);
    // 第二批从候选第 7 名起：与第一批零重叠
    expect(second.map((r) => r.id)).toEqual(['prod-s6', 'prod-s7']);
    expect(second.some((r) => first.some((f) => f.id === r.id))).toBe(false);
  });

  it('getRecommendations 个性化路径候选耗尽：返回空数组不抛错（E4 回绕信号）', async () => {
    mockQuery([{ product_id: 'prod-h1', freq: 1n, category_id: 'cat-1' }]);
    m.productFindMany
      .mockResolvedValueOnce([productRow('prod-h1', { categoryId: 'cat-1' })])
      .mockResolvedValueOnce([]) // 类目池无补货候选
      .mockResolvedValueOnce([]); // top3 徽章（不会走到，切片为空提前返回）

    // offset 超过候选总量（仅 1 条历史）
    await expect(service.getRecommendations('user-A', 6, 100)).resolves.toEqual([]);
  });

  it('getRecommendations 回退路径：skip = offset（offset=6 → skip 6, take 6）', async () => {
    m.productFindMany.mockResolvedValueOnce([productRow('top-7')]);

    const result = await service.getRecommendations(null, 6, 6);

    expect(m.queryRaw).not.toHaveBeenCalled();
    expect(m.productFindMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      take: 6,
      skip: 6,
    });
    expect(result[0]!.id).toBe('top-7');
  });

  it('getRecommendations 候选耗尽：个性化路径空数组时回退路径透传（不抛错）', async () => {
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);

    await expect(service.getRecommendations('user-A', 6, 100)).resolves.toEqual([]);
  });

  it('controller offset clamp 三态：-1→0 / NaN→0 / 1001→1000（buy-again）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-7', role: 'CUSTOMER', deviceType: 'client_app' } };

    // -1 → clamp 0：回退 skip = 6 + 0
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.buyAgain(undefined, '-1', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 6 }));

    // NaN → clamp 0
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.buyAgain(undefined, 'abc', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 6 }));

    // 1001 → clamp 1000：回退 skip = 6 + 1000
    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.buyAgain(undefined, '1001', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 1006 }));
  });

  it('controller offset clamp 三态：-1→0 / NaN→0 / 1001→1000（recommendations）', async () => {
    const controller = new ClientProductController(service);
    const req = { user: { sub: 'user-sub-8', role: 'CUSTOMER', deviceType: 'client_app' } };

    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.recommendations(undefined, '-1', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));

    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.recommendations(undefined, 'abc', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));

    mockQuery([]);
    m.productFindMany.mockResolvedValueOnce([]);
    await controller.recommendations(undefined, '1001', req);
    expect(m.productFindMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 1000 }));
  });
});

describe('JwtAuthGuard optional 分支', () => {
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

  it('optional + 无 token（super 抛 401）→ 降级匿名返回 true，不抛 UnauthorizedException', async () => {
    const { guard, context } = makeContext({ optionalAuth: true });
    // super.canActivate 走 passport：这里通过 spy 模拟 strategy 抛 401
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockRejectedValueOnce(
      new UnauthorizedException(),
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('optional + 有效 token → user 注入且返回 true', async () => {
    const user = { sub: 'u1', role: 'CUSTOMER', deviceType: 'client_app' };
    const { guard, context } = makeContext({ optionalAuth: true }, user);
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockResolvedValueOnce(true);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('非 optional 无 token → 仍 401（未标记路由零变化）', async () => {
    const { guard, context } = makeContext({});
    vi.spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate').mockRejectedValueOnce(
      new UnauthorizedException({ code: 'E-AUTH-002' }),
    );
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
