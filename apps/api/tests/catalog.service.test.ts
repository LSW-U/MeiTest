/**
 * Catalog Service 测试（W 流程 2026-06-24）
 *
 * 覆盖 product/sku/category/banner 关键场景
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const m = vi.hoisted(() => ({
  productFindMany: vi.fn(),
  productFindUnique: vi.fn(),
  productFindFirst: vi.fn(),
  productCreate: vi.fn(),
  productUpdate: vi.fn(),
  productDelete: vi.fn(),
  productCount: vi.fn(),
  productGroupBy: vi.fn(),
  skuFindMany: vi.fn(),
  skuFindUnique: vi.fn(),
  skuFindFirst: vi.fn(),
  skuCreate: vi.fn(),
  skuUpdate: vi.fn(),
  skuDelete: vi.fn(),
  categoryFindMany: vi.fn(),
  categoryFindUnique: vi.fn(),
  categoryCreate: vi.fn(),
  categoryUpdate: vi.fn(),
  categoryDelete: vi.fn(),
  categoryCount: vi.fn(),
  bannerFindMany: vi.fn(),
  bannerFindUnique: vi.fn(),
  bannerCreate: vi.fn(),
  bannerUpdate: vi.fn(),
  bannerDelete: vi.fn(),
  shopFindFirst: vi.fn(),
  stockFindMany: vi.fn(),
  reviewGroupBy: vi.fn(),
  reviewAggregate: vi.fn(),
  queryRaw: vi.fn(),
  salesCountLogCreate: vi.fn(),
  transaction: vi.fn(),
  // P2-3：count 缓存 redis mock（redis 是 Proxy 单例，mock 整个模块导出）
  redisGet: vi.fn(),
  redisIncr: vi.fn(),
  setWithTTL: vi.fn(),
}));

vi.mock('../src/shared/db', () => ({
  db: {
    product: {
      findMany: m.productFindMany,
      findUnique: m.productFindUnique,
      findFirst: m.productFindFirst,
      create: m.productCreate,
      update: m.productUpdate,
      delete: m.productDelete,
      count: m.productCount,
      groupBy: m.productGroupBy,
    },
    sku: {
      findMany: m.skuFindMany,
      findUnique: m.skuFindUnique,
      findFirst: m.skuFindFirst,
      create: m.skuCreate,
      update: m.skuUpdate,
      delete: m.skuDelete,
    },
    category: {
      findMany: m.categoryFindMany,
      findUnique: m.categoryFindUnique,
      create: m.categoryCreate,
      update: m.categoryUpdate,
      delete: m.categoryDelete,
      count: m.categoryCount,
    },
    banner: {
      findMany: m.bannerFindMany,
      findUnique: m.bannerFindUnique,
      create: m.bannerCreate,
      update: m.bannerUpdate,
      delete: m.bannerDelete,
    },
    shop: { findFirst: m.shopFindFirst },
    stock: { findMany: m.stockFindMany },
    review: { groupBy: m.reviewGroupBy, aggregate: m.reviewAggregate },
    salesCountLog: { create: m.salesCountLogCreate },
    $queryRaw: m.queryRaw,
    $transaction: m.transaction,
  },
}));

vi.mock('../src/shared/cache/redis', () => ({
  redis: {
    get: m.redisGet,
    incr: m.redisIncr,
  },
  setWithTTL: m.setWithTTL,
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';
import { db } from '../src/shared/db';
import {
  AdminSalesBatchAdjustRequest,
  AdminSalesBatchAdjustResponse,
  ProductDetail,
} from '@meimart/api-contract';

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch: vi.fn().mockResolvedValue(undefined) } as any);
    // B1/B7/B11：stock/rating/categoryName 聚合默认返空（字段 undefined/null，不阻塞主流程断言）
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    // 批B：detail 评分聚合默认无评论（avg=null count=0）
    m.reviewAggregate.mockResolvedValue({ _avg: { rating: null }, _count: 0 });
    m.categoryFindMany.mockResolvedValue([]);
    // P2-3：count 缓存 redis 默认 miss（ver=null→0，count key=null→回填），不阻塞现有用例
    m.redisGet.mockResolvedValue(null);
    m.redisIncr.mockResolvedValue(1);
    m.setWithTTL.mockResolvedValue(undefined);
  });

  const mockProduct = {
    id: 'prod-1',
    shopId: 'shop-1',
    categoryId: null,
    name: { en: 'Milk', zh: '牛奶' },
    description: null,
    mainImage: 'milk.png',
    images: [],
    status: 'ACTIVE',
    unit: { en: 'bag' },
    priceMin: 1500,
    salesCount: 100,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  describe('listProducts（客户端浏览）', () => {
    it('返回 ACTIVE 商品分页列表', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      // P0-2: batchGetDefaultSkuIds 用 sku.findMany
      m.skuFindMany.mockResolvedValueOnce([
        { id: 'sku-default', productId: 'prod-1' },
      ]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.items[0].name.en).toBe('Milk');
      // P0-2: defaultSkuId 应返回最低价 ACTIVE SKU id
      expect(result.items[0].defaultSkuId).toBe('sku-default');
    });

    it('按 keyword 搜索（raw ILIKE 大小写不敏感）', async () => {
      m.queryRaw.mockResolvedValueOnce([{ id: 'prod-1' }]);
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);

      await service.listProducts({ keyword: 'milk' });

      // raw ILIKE 搜 id（5 语言 OR），再 findMany where id in
      expect(m.queryRaw).toHaveBeenCalled();
      expect(m.productFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { in: ['prod-1'] } }),
        }),
      );
    });

    it('无 ACTIVE SKU 时 defaultSkuId 为 null', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.items[0].defaultSkuId).toBeNull();
    });

    it('列表项标记 isCategoryTop3（批D P2-1：Top3 批量直出，非 N+1）', async () => {
      const p1 = { ...mockProduct, id: 'prod-1', categoryId: 'cat-1' };
      const p2 = { ...mockProduct, id: 'prod-2', categoryId: 'cat-2' };
      m.productFindMany
        .mockResolvedValueOnce([p1, p2]) // 主列表查询
        .mockResolvedValueOnce([{ id: 'prod-1', categoryId: 'cat-1' }]); // Top3 批量查询（prod-2 落榜）
      m.productCount.mockResolvedValueOnce(2);
      m.skuFindMany.mockResolvedValueOnce([]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.items[0].isCategoryTop3).toBe(true);
      expect(result.items[1].isCategoryTop3).toBe(false);
      // 两次 findMany：主列表 1 + Top3 批量 1（非逐商品 N+1）
      expect(m.productFindMany).toHaveBeenCalledTimes(2);
    });

    it('无分类商品 isCategoryTop3 恒 false（Top3 查询短路不发生）', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]); // mockProduct.categoryId = null
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.items[0].isCategoryTop3).toBe(false);
      // 仅主列表 1 次：全 null 分类短路，Top3 查询不发生
      expect(m.productFindMany).toHaveBeenCalledTimes(1);
    });

    it('空列表不产生 Top3 查询', async () => {
      m.productFindMany.mockResolvedValueOnce([]);
      m.productCount.mockResolvedValueOnce(0);
      m.skuFindMany.mockResolvedValueOnce([]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.items).toHaveLength(0);
      expect(m.productFindMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProduct', () => {
    it('详情含 SKU 列表 + defaultSkuId 取最低价', async () => {
      m.productFindUnique.mockResolvedValueOnce({
        ...mockProduct,
        skus: [
          {
            id: 'sku-1',
            productId: 'prod-1',
            name: { en: '500g' },
            attributes: { weight: '500g' },
            price: 1500,
            imageUrl: null,
            status: 'ACTIVE',
            createdAt: new Date('2026-01-01'),
            updatedAt: new Date('2026-01-01'),
          },
        ],
      });
      const detail = await service.getProduct('prod-1');
      expect(detail.id).toBe('prod-1');
      expect(detail.skus).toHaveLength(1);
      expect(detail.skus[0].price).toBe(1500);
      // P0-2: defaultSkuId 取 skus[0].id（已按 price asc 排序）
      expect(detail.defaultSkuId).toBe('sku-1');
    });

    it('无 SKU 时 defaultSkuId 为 null', async () => {
      m.productFindUnique.mockResolvedValueOnce({ ...mockProduct, skus: [] });
      const detail = await service.getProduct('prod-1');
      expect(detail.defaultSkuId).toBeNull();
    });

    it('找不到抛 NotFoundException', async () => {
      m.productFindUnique.mockResolvedValueOnce(null);
      await expect(service.getProduct('missing')).rejects.toThrow(NotFoundException);
    });
  });

  // ===== 批B 2026-09-08：getProductDetail 聚合详情（stocks/totalStock/ratingCount/isCategoryTop3）=====
  describe('getProductDetail（批B 聚合详情）', () => {
    const skuRow = (id: string, price: number, productId = 'prod-1') => ({
      id,
      productId,
      name: { en: '500g' },
      attributes: { weight: '500g' },
      price,
      imageUrl: null,
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
    const detailProduct = (categoryId: string | null) => ({
      ...mockProduct,
      categoryId,
      skus: [skuRow('sku-1', 1500), skuRow('sku-2', 2800)],
    });

    it('聚合正确性：多仓多 SKU 分仓求和 + totalStock，stock 与 totalStock 同值', async () => {
      m.productFindUnique.mockResolvedValueOnce(detailProduct('cat-1'));
      // 故意乱序 + 同仓多行：wh-a 5+3、wh-b 7 -> 聚合 [wh-a:8, wh-b:7]
      m.stockFindMany.mockResolvedValueOnce([
        { warehouseId: 'wh-b', quantity: 7, warehouse: { name: { en: 'WhB' } } },
        { warehouseId: 'wh-a', quantity: 5, warehouse: { name: { en: 'WhA' } } },
        { warehouseId: 'wh-a', quantity: 3, warehouse: { name: { en: 'WhA' } } },
      ]);
      m.reviewAggregate.mockResolvedValueOnce({ _avg: { rating: 4.46 }, _count: 5 });
      m.categoryFindMany.mockResolvedValueOnce([{ id: 'cat-1', name: { en: 'Drinks' } }]);
      m.productFindMany.mockResolvedValueOnce([{ id: 'prod-1' }]); // Top3 含自己

      const detail = await service.getProductDetail('prod-1');

      // 分仓聚合 + warehouseId 升序输出
      expect(detail.stocks).toEqual([
        { warehouseId: 'wh-a', name: { en: 'WhA' }, quantity: 8 },
        { warehouseId: 'wh-b', name: { en: 'WhB' }, quantity: 7 },
      ]);
      expect(detail.totalStock).toBe(15);
      // 兼容透传：stock 与 totalStock 同值（同口径 ACTIVE SKU 求和）
      expect(detail.stock).toBe(15);
      expect(detail.defaultSkuId).toBe('sku-1'); // price asc 最低价
      expect(detail.skus).toHaveLength(2);
      expect(detail.isCategoryTop3).toBe(true);
      expect(detail.ratingCount).toBe(5);
    });

    it('空数据：无库存无评论无分类 -> stocks=[] totalStock=0 ratingCount=0 rating undefined isCategoryTop3=false', async () => {
      m.productFindUnique.mockResolvedValueOnce(detailProduct(null));
      // stockFindMany / reviewAggregate 走 beforeEach 默认空；categoryId=null 短路不查 Top3

      const detail = await service.getProductDetail('prod-1');

      expect(detail.stocks).toEqual([]);
      expect(detail.totalStock).toBe(0);
      // 兼容透传语义：无库存记录 = undefined（与 batchGetProductStock 一致）
      expect(detail.stock).toBeUndefined();
      expect(detail.rating).toBeUndefined();
      expect(detail.ratingCount).toBe(0);
      expect(detail.isCategoryTop3).toBe(false);
      // 无分类：不发起 Top3 查询（productFindMany 未被调用）
      expect(m.productFindMany).not.toHaveBeenCalled();
    });

    it('Top3 查询参数锁定：categoryId + ACTIVE 过滤，salesCount desc + id asc 兜并列，take 3', async () => {
      m.productFindUnique.mockResolvedValueOnce(detailProduct('cat-1'));
      m.productFindMany.mockResolvedValueOnce([]); // Top3 不含自己

      const detail = await service.getProductDetail('prod-1');

      expect(detail.isCategoryTop3).toBe(false);
      // 吃 @@index([status, salesCount])：where categoryId+status，orderBy salesCount desc、id asc 稳定并列
      expect(m.productFindMany).toHaveBeenCalledWith({
        where: { categoryId: 'cat-1', status: 'ACTIVE' },
        orderBy: [
          { salesCount: 'desc' },
          { id: 'asc' },
        ],
        take: 3,
        select: { id: true },
      });
    });

    it('Top3 并列 tie-break 行为：同分两名，DB 按 id asc 只取前者入选（后者 false）', async () => {
      // 审查 P3-1：prod-1 与 prod-2 同 salesCount 并列第 3，DB orderBy id asc tie-break
      // 只把 prod-1 带回 top3 结果集 —— service 以结果集为准（不做二次比较）
      m.productFindUnique.mockResolvedValueOnce(detailProduct('cat-1'));
      m.productFindMany.mockResolvedValueOnce([{ id: 'prod-1' }, { id: 'peer-a' }, { id: 'peer-b' }]);
      expect((await service.getProductDetail('prod-1')).isCategoryTop3).toBe(true);

      m.productFindUnique.mockResolvedValueOnce({ ...detailProduct('cat-1'), id: 'prod-2' });
      m.productFindMany.mockResolvedValueOnce([{ id: 'prod-1' }, { id: 'peer-a' }, { id: 'peer-b' }]);
      expect((await service.getProductDetail('prod-2')).isCategoryTop3).toBe(false);
    });

    it('评分精度：rating 与 ratingCount 同源聚合（APPROVED，toFixed(1)）', async () => {
      m.productFindUnique.mockResolvedValueOnce(detailProduct(null));
      m.reviewAggregate.mockResolvedValueOnce({ _avg: { rating: 4.46 }, _count: 5 });

      const detail = await service.getProductDetail('prod-1');

      expect(detail.rating).toBe(4.5); // Number((4.46).toFixed(1))，与 batchGetProductRating 同公式
      expect(detail.ratingCount).toBe(5);
      // 同源口径锁定：where productId + APPROVED
      expect(m.reviewAggregate).toHaveBeenCalledWith({
        _avg: { rating: true },
        _count: true,
        where: { productId: 'prod-1', status: 'APPROVED' },
      });
    });

    it('404：商品不存在抛 E-CATALOG-001', async () => {
      m.productFindUnique.mockResolvedValueOnce(null);
      await expect(service.getProductDetail('missing')).rejects.toMatchObject({
        response: { code: 'E-CATALOG-001' },
        status: 404,
      });
    });

    it('响应过契约 ProductDetail schema（safeParse，UUID 形态数据）', async () => {
      const uuid = (n: number) =>
        `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
      m.productFindUnique.mockResolvedValueOnce({
        ...detailProduct(uuid(3)),
        id: uuid(1),
        shopId: uuid(2),
        skus: [skuRow(uuid(4), 1500, uuid(1)), skuRow(uuid(5), 2800, uuid(1))],
      });
      m.stockFindMany.mockResolvedValueOnce([
        { warehouseId: uuid(6), quantity: 5, warehouse: { name: { en: 'WhA' } } },
        { warehouseId: uuid(7), quantity: 7, warehouse: { name: { en: 'WhB' } } },
      ]);
      m.reviewAggregate.mockResolvedValueOnce({ _avg: { rating: 4.0 }, _count: 2 });
      m.categoryFindMany.mockResolvedValueOnce([{ id: uuid(3), name: { en: 'Drinks' } }]);
      m.productFindMany.mockResolvedValueOnce([{ id: uuid(1) }]);

      const detail = await service.getProductDetail(uuid(1));
      const parsed = ProductDetail.safeParse(detail);
      expect(parsed.success).toBe(true);
    });
  });

  describe('getRecommendations', () => {
    it('按 salesCount desc 返 top N', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.skuFindMany.mockResolvedValueOnce([]);
      const result = await service.getRecommendations(6);
      expect(result).toHaveLength(1);
      expect(m.productFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { salesCount: 'desc' },
          take: 6,
        }),
      );
    });
  });

  describe('admin CRUD', () => {
    it('createProduct 自动绑定 shopId', async () => {
      m.shopFindFirst.mockResolvedValueOnce({ id: 'shop-1' });
      m.productCreate.mockResolvedValueOnce(mockProduct);

      const result = await service.createProduct({
        name: { en: 'Milk' },
        mainImage: 'milk.png',
        unit: { en: 'bag' },
      });
      expect(result.id).toBe('prod-1');
      expect(m.productCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ shopId: 'shop-1', priceMin: 0 }),
        }),
      );
    });

    it('updateProduct 局部更新', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.productUpdate.mockResolvedValueOnce({ ...mockProduct, mainImage: 'new.png' });

      const result = await service.updateProduct('prod-1', { mainImage: 'new.png' });
      expect(result.mainImage).toBe('new.png');
    });

    it('deleteProduct 找不到抛 NotFoundException', async () => {
      m.productFindUnique.mockResolvedValueOnce(null);
      await expect(service.deleteProduct('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('SKU', () => {
    it('createSku 触发 product.priceMin 重算', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.skuCreate.mockResolvedValueOnce({
        id: 'sku-1',
        productId: 'prod-1',
        name: { en: '500g' },
        attributes: {},
        price: 1200,
        imageUrl: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      m.skuFindFirst.mockResolvedValueOnce({ price: 1200 });
      m.productUpdate.mockResolvedValueOnce({});

      const result = await service.createSku('prod-1', {
        name: { en: '500g' },
        attributes: {},
        price: 1200,
      });
      expect(result.price).toBe(1200);
      expect(m.productUpdate).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { priceMin: 1200 },
      });
    });

    it('createSku 商品不存在抛 NotFoundException', async () => {
      m.productFindUnique.mockResolvedValueOnce(null);
      await expect(
        service.createSku('missing', { name: { en: 'x' }, attributes: {}, price: 100 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Category', () => {
    it('listCategoryTree 返两层嵌套（roots + children，按 sortOrder）', async () => {
      m.categoryFindMany.mockResolvedValueOnce([
        { id: 'cat-1', name: { en: 'Drinks' }, iconUrl: 'i', parentId: null, sortOrder: 1, status: 'ACTIVE' },
        { id: 'cat-2', name: { en: 'Coffee' }, iconUrl: 'i', parentId: 'cat-1', sortOrder: 1, status: 'ACTIVE' },
        { id: 'cat-3', name: { en: 'Tea' }, iconUrl: 'i', parentId: 'cat-1', sortOrder: 2, status: 'ACTIVE' },
      ]);
      const tree = await service.listCategoryTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('cat-1');
      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children?.map((c) => c.id)).toEqual(['cat-2', 'cat-3']);
    });

    it('createCategory parentId 不存在 -> E-CATALOG-010', async () => {
      m.categoryFindUnique.mockResolvedValueOnce(null);
      await expect(
        service.createCategory({ name: { en: 'X' }, iconUrl: '', parentId: 'missing' }),
      ).rejects.toMatchObject({ response: { code: 'E-CATALOG-010' }, status: 400 });
    });

    it('createCategory parent 非顶级 -> E-CATALOG-011（锁 2 层）', async () => {
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'p', parentId: 'grandpa' });
      await expect(
        service.createCategory({ name: { en: 'X' }, iconUrl: '', parentId: 'p' }),
      ).rejects.toMatchObject({ response: { code: 'E-CATALOG-011' }, status: 400 });
    });

    it('deleteCategory 有 ACTIVE 子分类 -> E-CATALOG-014', async () => {
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'cat-1', parentId: null });
      m.categoryCount.mockResolvedValueOnce(2);
      await expect(service.deleteCategory('cat-1')).rejects.toMatchObject({
        response: { code: 'E-CATALOG-014' },
        status: 400,
      });
    });

    it('deleteCategory 有在售商品 -> E-CATALOG-015（审查建议 2）', async () => {
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'cat-1', parentId: null });
      m.categoryCount.mockResolvedValueOnce(0); // 无子分类（过 014 校验）
      m.productCount.mockResolvedValueOnce(3); // 3 个在售商品
      await expect(service.deleteCategory('cat-1')).rejects.toMatchObject({
        response: { code: 'E-CATALOG-015' },
        status: 400,
      });
    });

    it('deleteCategory 找不到抛 NotFoundException', async () => {
      m.categoryFindUnique.mockResolvedValueOnce(null);
      await expect(service.deleteCategory('missing')).rejects.toThrow(NotFoundException);
    });

    // ===== 审查 F1：补 update 锁 2 层校验（012/013）+ admin 含 INACTIVE + 软删过滤 + 商品查询适配 =====

    it('updateCategory parentId=自身 -> E-CATALOG-012（自引用）', async () => {
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'cat-1', parentId: null });
      await expect(
        service.updateCategory('cat-1', { parentId: 'cat-1' }),
      ).rejects.toMatchObject({ response: { code: 'E-CATALOG-012' }, status: 400 });
    });

    it('updateCategory 已有子分类还想挂父 -> E-CATALOG-013（锁 2 层）', async () => {
      // existing=cat-1（顶级，已有子分类）；挂到 cat-2 下会变 3 层 -> 禁
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'cat-1', parentId: null }); // existing
      m.categoryFindUnique.mockResolvedValueOnce({ id: 'cat-2', parentId: null }); // parent（顶级，合法）
      m.categoryCount.mockResolvedValueOnce(1); // cat-1 已有 1 个子分类
      await expect(
        service.updateCategory('cat-1', { parentId: 'cat-2' }),
      ).rejects.toMatchObject({ response: { code: 'E-CATALOG-013' }, status: 400 });
    });

    it('listCategoriesAdmin 返平铺含 INACTIVE + productCount（admin 不过滤 status）', async () => {
      m.categoryFindMany.mockResolvedValueOnce([
        { id: 'cat-1', name: { en: 'Drinks' }, iconUrl: 'i', parentId: null, sortOrder: 1, status: 'ACTIVE' },
        { id: 'cat-2', name: { en: 'Old' }, iconUrl: 'i', parentId: null, sortOrder: 2, status: 'INACTIVE' },
      ]);
      // F2：groupBy 批量返 ACTIVE 商品数（cat-1 有 3 个，cat-2 无）
      m.productGroupBy.mockResolvedValueOnce([
        { categoryId: 'cat-1', _count: { _all: 3 } },
      ]);
      const list = await service.listCategoriesAdmin();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.status)).toEqual(['ACTIVE', 'INACTIVE']);
      // F2：productCount 与 deleteCategory E-CATALOG-015 同口径（仅 ACTIVE）
      expect(list[0].productCount).toBe(3);
      expect(list[1].productCount).toBe(0);
      // 关键：分类查询 where 不含 status 过滤（admin 看全部）
      const callArg = m.categoryFindMany.mock.calls[0][0];
      expect(callArg?.where?.status).toBeUndefined();
      // 关键：商品计数按 categoryId groupBy，where 过滤 ACTIVE
      const groupArg = m.productGroupBy.mock.calls[0][0];
      expect(groupArg?.where).toEqual({ status: 'ACTIVE' });
    });

    it('listCategoryTree 过滤 ACTIVE（软删 INACTIVE 不出现在客户端树）', async () => {
      m.categoryFindMany.mockResolvedValueOnce([]);
      await service.listCategoryTree();
      // 关键：客户端树只返 ACTIVE（修软删分类仍返客户端的 bug，锁定回归）
      expect(m.categoryFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'ACTIVE' } }),
      );
    });

    it('商品查询 categoryId=大类 返大类+子分类商品（categoryId in [大类, ...子分类]）', async () => {
      // cat-parent 下有 1 个子分类 cat-child
      m.categoryFindMany.mockResolvedValueOnce([{ id: 'cat-child' }]);
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);

      await service.listProducts({ categoryId: 'cat-parent' });

      // 关键：where.categoryId = { in: [大类, ...所有子分类] }
      expect(m.productFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            categoryId: { in: ['cat-parent', 'cat-child'] },
          }),
        }),
      );
    });
  });

  describe('Banner', () => {
    it('listBanners onlyActive 过滤', async () => {
      m.bannerFindMany.mockResolvedValueOnce([
        {
          id: 'b-1',
          imageUrl: 'b.png',
          alt: { en: 'Banner' },
          linkType: 'PRODUCT',
          linkValue: 'prod-1',
          sortOrder: 1,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      const list = await service.listBanners(true);
      expect(list[0].id).toBe('b-1');
      expect(m.bannerFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE' },
        }),
      );
    });

    it('createBanner 默认 ACTIVE', async () => {
      m.bannerCreate.mockResolvedValueOnce({
        id: 'b-new',
        imageUrl: 'x.png',
        alt: null,
        linkType: 'NONE',
        linkValue: null,
        sortOrder: 0,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const result = await service.createBanner({
        imageUrl: 'x.png',
        linkType: 'NONE',
      });
      expect(result.id).toBe('b-new');
    });
  });

  // ===== P2-3：count 缓存（无 keyword 走 redis 版本号 bump；有 keyword let-through）=====
  describe('listProducts count 缓存（P2-3）', () => {
    it('无 keyword + cache miss -> 查 DB + setWithTTL 回填', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(42);
      m.skuFindMany.mockResolvedValueOnce([]);

      const result = await service.listProducts({ page: 1, pageSize: 20 });

      expect(result.total).toBe(42);
      expect(m.productCount).toHaveBeenCalledTimes(1);
      // 回填 key：v0（默认版本，redis 空）+ ACTIVE + _all_（无 categoryId）
      expect(m.setWithTTL).toHaveBeenCalledWith('catalog:count:v0:ACTIVE:_all_', '42', 120);
    });

    it('无 keyword + cache hit -> 不查 DB，直接返缓存值', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.skuFindMany.mockResolvedValueOnce([]);
      // ver 默认 null→0（首次 get）；count key get 命中 99
      m.redisGet.mockResolvedValueOnce(null).mockResolvedValueOnce('99');

      const result = await service.listProducts({ page: 1, pageSize: 20 });

      expect(result.total).toBe(99);
      expect(m.productCount).not.toHaveBeenCalled();
      expect(m.setWithTTL).not.toHaveBeenCalled();
    });

    it('cache key 含版本号（bump 后 ver 进 key）', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);
      // ver=5（getCountVersion 读到），count key miss
      m.redisGet.mockResolvedValueOnce('5').mockResolvedValueOnce(null);

      await service.listProducts({ page: 1, pageSize: 20 });

      expect(m.setWithTTL).toHaveBeenCalledWith('catalog:count:v5:ACTIVE:_all_', '1', 120);
    });

    it('categoryId 进 cache key（子分类适配下 parent+children 排序后 join）', async () => {
      // listProducts 拼 [parent, ...children] = ['cat-parent','cat-z','cat-a']
      // getCachedCount 内 sort() 后 join：'cat-a,cat-parent,cat-z'
      m.categoryFindMany.mockResolvedValueOnce([{ id: 'cat-z' }, { id: 'cat-a' }]);
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(3);
      m.skuFindMany.mockResolvedValueOnce([]);

      await service.listProducts({ categoryId: 'cat-parent' });

      expect(m.setWithTTL).toHaveBeenCalledWith(
        'catalog:count:v0:ACTIVE:cat-a,cat-parent,cat-z',
        '3',
        120,
      );
    });

    it('有 keyword -> let-through，不查缓存', async () => {
      m.queryRaw.mockResolvedValueOnce([{ id: 'prod-1' }]);
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(5);
      m.skuFindMany.mockResolvedValueOnce([]);

      await service.listProducts({ keyword: 'milk' });

      // 关键：keyword 高基数，不走缓存（redis get/setWithTTL 都不调），直查 DB
      expect(m.redisGet).not.toHaveBeenCalled();
      expect(m.setWithTTL).not.toHaveBeenCalled();
      expect(m.productCount).toHaveBeenCalledTimes(1);
    });

    it('redis 故障降级走 DB（不阻塞搜索）', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(7);
      m.skuFindMany.mockResolvedValueOnce([]);
      m.redisGet.mockRejectedValueOnce(new Error('redis down'));

      // 关键：redis 抛错被 try/catch 吞，降级走 DB count
      const result = await service.listProducts({ page: 1, pageSize: 20 });
      expect(result.total).toBe(7);
      expect(m.productCount).toHaveBeenCalledTimes(1);
    });
  });

  describe('商品 CRUD 触发 count 缓存 bump（P2-3）', () => {
    it('createProduct 触发 INCR catalog:count:ver', async () => {
      m.shopFindFirst.mockResolvedValueOnce({ id: 'shop-1' });
      m.productCreate.mockResolvedValueOnce(mockProduct);

      await service.createProduct({
        name: { en: 'Milk' },
        mainImage: 'milk.png',
        unit: { en: 'bag' },
      });

      expect(m.redisIncr).toHaveBeenCalledWith('catalog:count:ver');
    });

    it('updateProduct 改 status 触发 INCR catalog:count:ver（影响 ACTIVE count）', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.productUpdate.mockResolvedValueOnce({ ...mockProduct, status: 'INACTIVE' });

      await service.updateProduct('prod-1', { status: 'INACTIVE' });

      expect(m.redisIncr).toHaveBeenCalledWith('catalog:count:ver');
    });

    it('updateProduct 改 categoryId 触发 INCR（影响分类 count）', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.productUpdate.mockResolvedValueOnce({ ...mockProduct, categoryId: 'cat-new' });

      await service.updateProduct('prod-1', { categoryId: 'cat-new' });

      expect(m.redisIncr).toHaveBeenCalledWith('catalog:count:ver');
    });

    it('updateProduct 只改 mainImage 不触发 bump（精确失效，name/image 不影响 count）', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.productUpdate.mockResolvedValueOnce({ ...mockProduct, mainImage: 'new.png' });

      await service.updateProduct('prod-1', { mainImage: 'new.png' });

      expect(m.redisIncr).not.toHaveBeenCalled();
    });

    it('deleteProduct 触发 INCR catalog:count:ver（软删 status→INACTIVE）', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.productUpdate.mockResolvedValueOnce({}); // 软删 update

      await service.deleteProduct('prod-1');

      expect(m.redisIncr).toHaveBeenCalledWith('catalog:count:ver');
    });

    it('createSku 不触发 bump（不影响 product count）', async () => {
      m.productFindUnique.mockResolvedValueOnce(mockProduct);
      m.skuCreate.mockResolvedValueOnce({
        id: 'sku-1',
        productId: 'prod-1',
        name: { en: '500g' },
        attributes: {},
        price: 1200,
        imageUrl: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      m.skuFindFirst.mockResolvedValueOnce({ price: 1200 });
      m.productUpdate.mockResolvedValueOnce({}); // recomputeProductPriceMin

      await service.createSku('prod-1', { name: { en: '500g' }, attributes: {}, price: 1200 });

      expect(m.redisIncr).not.toHaveBeenCalled();
    });
  });

  describe('adminAdjustSalesCountBatch（批C 销量批量调整）', () => {
    it('事务透传 + items 映射 productId + operatorId 传递，写 ADMIN_ADJUST 审计', async () => {
      // $transaction 直接以 db 自身作为 tx 执行回调（薄透传验证）
      m.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
      m.productFindUnique.mockResolvedValue({ salesCount: 10 });
      m.queryRaw.mockResolvedValue([{ sales_count: 25 }]);
      m.salesCountLogCreate.mockResolvedValue({});

      const res = await service.adminAdjustSalesCountBatch(
        [{ id: 'prod-1', salesCount: 25 }],
        'admin-1',
      );

      expect(res).toEqual({ adjusted: ['prod-1'], skipped: [] });
      expect(m.transaction).toHaveBeenCalledTimes(1);
      // tagged template 参数：[strings, delta, productId]；delta = 25 − 10 = 15
      expect(m.queryRaw.mock.calls[0]![1]).toBe(15);
      expect(m.queryRaw.mock.calls[0]![2]).toBe('prod-1');
      expect(m.salesCountLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            changeType: 'ADMIN_ADJUST',
            changeQty: 15,
            beforeQty: 10,
            afterQty: 25,
            operatorId: 'admin-1',
          }),
        }),
      );
    });

    it('商品不存在 → skipped 透传给 controller', async () => {
      m.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(db));
      m.productFindUnique.mockResolvedValue(null);

      const res = await service.adminAdjustSalesCountBatch(
        [{ id: 'prod-x', salesCount: 5 }],
        'admin-1',
      );

      expect(res).toEqual({ adjusted: [], skipped: ['prod-x'] });
    });

    it('契约 AdminSalesBatchAdjustRequest/Response safeParse：min/max/uuid/int/min(0) 声明实际执行（审查 P3-5，照批B 先例）', () => {
      // controller 单测 mock 不经过 ZodValidationPipe（既有盲区），契约声明在此直接执行
      const uuid = (n: number) =>
        `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
      // 合法：设值语义（uuid + >=0 整数），1 条即可
      expect(
        AdminSalesBatchAdjustRequest.safeParse({ items: [{ id: uuid(1), salesCount: 0 }] })
          .success,
      ).toBe(true);
      // 空数组 → min(1) 拒
      expect(AdminSalesBatchAdjustRequest.safeParse({ items: [] }).success).toBe(false);
      // 恰 100 条 → max(100) 边界内通过
      const full = Array.from({ length: 100 }, () => ({ id: uuid(1), salesCount: 1 }));
      expect(AdminSalesBatchAdjustRequest.safeParse({ items: full }).success).toBe(true);
      // 101 条 → max(100) 拒
      const overflow = Array.from({ length: 101 }, () => ({ id: uuid(1), salesCount: 1 }));
      expect(AdminSalesBatchAdjustRequest.safeParse({ items: overflow }).success).toBe(false);
      // 非 uuid id 拒
      expect(
        AdminSalesBatchAdjustRequest.safeParse({ items: [{ id: 'prod-1', salesCount: 5 }] })
          .success,
      ).toBe(false);
      // 负数 / 小数 → int().min(0) 拒
      expect(
        AdminSalesBatchAdjustRequest.safeParse({ items: [{ id: uuid(2), salesCount: -1 }] })
          .success,
      ).toBe(false);
      expect(
        AdminSalesBatchAdjustRequest.safeParse({ items: [{ id: uuid(3), salesCount: 1.5 }] })
          .success,
      ).toBe(false);
      // 响应 schema：adjusted/skipped 均为 uuid 数组
      expect(
        AdminSalesBatchAdjustResponse.safeParse({ adjusted: [uuid(4)], skipped: [] }).success,
      ).toBe(true);
    });
  });
});
