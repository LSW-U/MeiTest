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
  bannerFindMany: vi.fn(),
  bannerFindUnique: vi.fn(),
  bannerCreate: vi.fn(),
  bannerUpdate: vi.fn(),
  bannerDelete: vi.fn(),
  shopFindFirst: vi.fn(),
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
    },
    banner: {
      findMany: m.bannerFindMany,
      findUnique: m.bannerFindUnique,
      create: m.bannerCreate,
      update: m.bannerUpdate,
      delete: m.bannerDelete,
    },
    shop: { findFirst: m.shopFindFirst },
  },
}));

import { CatalogService } from '../src/modules/catalog/catalog.service';

describe('CatalogService', () => {
  let service: CatalogService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new CatalogService();
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

    it('按 keyword 搜索', async () => {
      m.productFindMany.mockResolvedValueOnce([mockProduct]);
      m.productCount.mockResolvedValueOnce(1);
      m.skuFindMany.mockResolvedValueOnce([]);

      await service.listProducts({ keyword: 'Milk' });
      expect(m.productFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ name: { path: ['en'], string_contains: 'Milk' } }),
            ]),
          }),
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
    it('listCategories 返回排序后的分类', async () => {
      m.categoryFindMany.mockResolvedValueOnce([
        {
          id: 'cat-1',
          name: { en: 'Drinks' },
          iconUrl: 'icon.png',
          parentId: null,
          sortOrder: 1,
        },
      ]);
      const list = await service.listCategories();
      expect(list[0].id).toBe('cat-1');
      expect(list[0].name.en).toBe('Drinks');
    });

    it('deleteCategory 找不到抛 NotFoundException', async () => {
      m.categoryFindUnique.mockResolvedValueOnce(null);
      await expect(service.deleteCategory('missing')).rejects.toThrow(NotFoundException);
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
