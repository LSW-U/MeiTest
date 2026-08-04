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
  queryRaw: vi.fn(),
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
    review: { groupBy: m.reviewGroupBy },
    $queryRaw: m.queryRaw,
  },
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService({ recordSearch: vi.fn().mockResolvedValue(undefined) } as any);
    // B1/B7/B11：stock/rating/categoryName 聚合默认返空（字段 undefined/null，不阻塞主流程断言）
    m.stockFindMany.mockResolvedValue([]);
    m.reviewGroupBy.mockResolvedValue([]);
    m.categoryFindMany.mockResolvedValue([]);
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

    it('listCategoriesAdmin 返平铺含 INACTIVE（admin 不过滤 status）', async () => {
      m.categoryFindMany.mockResolvedValueOnce([
        { id: 'cat-1', name: { en: 'Drinks' }, iconUrl: 'i', parentId: null, sortOrder: 1, status: 'ACTIVE' },
        { id: 'cat-2', name: { en: 'Old' }, iconUrl: 'i', parentId: null, sortOrder: 2, status: 'INACTIVE' },
      ]);
      const list = await service.listCategoriesAdmin();
      expect(list).toHaveLength(2);
      expect(list.map((c) => c.status)).toEqual(['ACTIVE', 'INACTIVE']);
      // 关键：admin 看全部，where 不含 status 过滤
      const callArg = m.categoryFindMany.mock.calls[0][0];
      expect(callArg?.where?.status).toBeUndefined();
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
});
