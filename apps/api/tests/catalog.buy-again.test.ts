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
    const rec = await service.getRecommendations(6);

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

    const result = await controller.buyAgain(undefined, req);

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

// ===== OptionalAuth guard：无效 token 匿名不 401 / 未标记路由零变化 =====

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
