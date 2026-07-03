/**
 * Catalog Service（W 流程 2026-06-24）
 *
 * 覆盖 4 resource：Product / Sku / Category / Banner
 *
 * 客户端接口：列表/详情/搜索/推荐/分类/Banner（公开，浏览型）
 * 后台接口：CRUD（super_admin / warehouse_staff）
 *
 * 关键设计：
 * - Product.priceMin 由 SKU 聚合，创建 SKU 时同步更新 product.priceMin
 * - 客户端列表只返回 ACTIVE 商品，后台可看全部
 * - 搜索按 i18n name 匹配（4 语言任一命中）
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { db } from '../../shared/db';
import { Prisma, ProductStatus, SkuStatus } from '../../prisma/client';

@Injectable()
export class CatalogService {
  // ===== 客户端：商品浏览 =====

  /** 商品列表（客户端只看 ACTIVE） */
  async listProducts(opts: {
    categoryId?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
    status?: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  } = {}) {
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 20, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.ProductWhereInput = {
      ...(opts.status && { status: opts.status }),
      ...(!opts.status && { status: 'ACTIVE' }), // 默认 ACTIVE
      ...(opts.categoryId && { categoryId: opts.categoryId }),
      ...(opts.keyword && {
        OR: [
          { name: { path: ['en'], string_contains: opts.keyword } },
          { name: { path: ['zh'], string_contains: opts.keyword } },
          { name: { path: ['id'], string_contains: opts.keyword } },
          { name: { path: ['pt'], string_contains: opts.keyword } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      db.product.findMany({
        where,
        orderBy: [{ salesCount: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      db.product.count({ where }),
    ]);

    const defaultSkuMap = await this.batchGetDefaultSkuIds(items.map((p) => p.id));

    return {
      items: items.map((p) => ({
        ...this.toProductDTO(p),
        defaultSkuId: defaultSkuMap.get(p.id) ?? null,
      })),
      page,
      pageSize,
      total,
      hasMore: skip + items.length < total,
    };
  }

  /** 商品详情（含 SKU 列表） */
  async getProduct(id: string) {
    const product = await db.product.findUnique({
      where: { id },
      include: { skus: { where: { status: 'ACTIVE' }, orderBy: { price: 'asc' } } },
    });
    if (!product) {
      throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Product not found' });
    }
    return {
      ...this.toProductDTO(product),
      defaultSkuId: product.skus[0]?.id ?? null,
      skus: product.skus.map((s) => this.toSkuDTO(s)),
    };
  }

  /** 推荐商品（按销量 top N） */
  async getRecommendations(limit = 6) {
    const items = await db.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      take: limit,
    });
    const defaultSkuMap = await this.batchGetDefaultSkuIds(items.map((p) => p.id));
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
    }));
  }

  /** 再买一次（按用户历史简化：返回销量 top N 偏移 limit） */
  async getBuyAgain(limit = 6) {
    const items = await db.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { salesCount: 'desc' },
      skip: limit,
      take: limit,
    });
    const defaultSkuMap = await this.batchGetDefaultSkuIds(items.map((p) => p.id));
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
    }));
  }

  // ===== 后台：商品 CRUD =====

  async adminListProducts(status?: string) {
    const items = await db.product.findMany({
      where: status ? { status: status as ProductStatus } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const defaultSkuMap = await this.batchGetDefaultSkuIds(items.map((p) => p.id));
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
    }));
  }

  async createProduct(input: {
    categoryId?: string | null;
    name: Record<string, string>;
    description?: Record<string, string> | null;
    mainImage: string;
    images?: string[];
    unit: Record<string, string>;
    status?: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  }) {
    const shop = await db.shop.findFirst();
    if (!shop) {
      throw new BadRequestException({
        code: 'E-SHOP-001',
        message: 'Shop not initialized',
      });
    }

    const created = await db.product.create({
      data: {
        shopId: shop.id,
        categoryId: input.categoryId ?? null,
        name: input.name,
        description: (input.description ?? null) as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
        mainImage: input.mainImage,
        images: input.images ?? [],
        unit: input.unit,
        status: (input.status ?? 'ACTIVE') as ProductStatus,
        priceMin: 0, // 没 SKU 前是 0
      },
    });
    return this.toProductDTO(created);
  }

  async updateProduct(id: string, input: Partial<{
    categoryId: string | null;
    name: Record<string, string>;
    description: Record<string, string> | null;
    mainImage: string;
    images: string[];
    unit: Record<string, string>;
    status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  }>) {
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Product not found' });

    const updated = await db.product.update({
      where: { id },
      data: {
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue }),
        ...(input.mainImage !== undefined && { mainImage: input.mainImage }),
        ...(input.images !== undefined && { images: input.images }),
        ...(input.unit !== undefined && { unit: input.unit }),
        ...(input.status !== undefined && { status: input.status as ProductStatus }),
      },
    });
    return this.toProductDTO(updated);
  }

  async updateProductStatus(id: string, status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK') {
    return this.updateProduct(id, { status });
  }

  async deleteProduct(id: string) {
    const existing = await db.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Product not found' });
    // 软删除：商品可能被 SKU / OrderItem / Favorite 引用，硬删会丢历史订单详情
    await db.product.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  // ===== SKU =====

  async listSkusByProduct(productId: string) {
    const skus = await db.sku.findMany({
      where: { productId },
      orderBy: { price: 'asc' },
    });
    return skus.map((s) => this.toSkuDTO(s));
  }

  async createSku(productId: string, input: {
    name: Record<string, string>;
    attributes: Record<string, unknown>;
    price: number;
    imageUrl?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Product not found' });

    const created = await db.sku.create({
      data: {
        productId,
        name: input.name,
        attributes: input.attributes as Prisma.InputJsonValue,
        price: input.price,
        imageUrl: input.imageUrl ?? null,
        status: (input.status ?? 'ACTIVE') as SkuStatus,
      },
    });

    // 更新 product.priceMin（取最低 ACTIVE SKU）
    await this.recomputeProductPriceMin(productId);

    return this.toSkuDTO(created);
  }

  async updateSku(skuId: string, input: Partial<{
    name: Record<string, string>;
    attributes: Record<string, unknown>;
    price: number;
    imageUrl: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  }>) {
    const existing = await db.sku.findUnique({ where: { id: skuId } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Sku not found' });

    const updated = await db.sku.update({
      where: { id: skuId },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.attributes !== undefined && { attributes: input.attributes as Prisma.InputJsonValue }),
        ...(input.price !== undefined && { price: input.price }),
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.status !== undefined && { status: input.status as SkuStatus }),
      },
    });

    await this.recomputeProductPriceMin(existing.productId);

    return this.toSkuDTO(updated);
  }

  async deleteSku(skuId: string) {
    const existing = await db.sku.findUnique({ where: { id: skuId } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Sku not found' });
    // 软删除：SKU 可能被 Stock / OrderItem 引用，硬删会丢历史订单详情
    await db.sku.update({ where: { id: skuId }, data: { status: 'INACTIVE' } });
    await this.recomputeProductPriceMin(existing.productId);
  }

  /** 重算 product.priceMin（取最低 ACTIVE SKU 价格；无 SKU 为 0） */
  private async recomputeProductPriceMin(productId: string) {
    const minSku = await db.sku.findFirst({
      where: { productId, status: 'ACTIVE' },
      orderBy: { price: 'asc' },
    });
    await db.product.update({
      where: { id: productId },
      data: { priceMin: minSku?.price ?? 0 },
    });
  }

  // ===== Category =====

  async listCategories() {
    const items = await db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    return items.map((c) => ({
      id: c.id,
      name: c.name as Record<string, string>,
      iconUrl: c.iconUrl,
      parentId: c.parentId,
      sortOrder: c.sortOrder,
    }));
  }

  async createCategory(input: {
    name: Record<string, string>;
    iconUrl: string;
    parentId?: string | null;
    sortOrder?: number;
  }) {
    const created = await db.category.create({
      data: {
        name: input.name,
        iconUrl: input.iconUrl,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
      },
    });
    return {
      id: created.id,
      name: created.name as Record<string, string>,
      iconUrl: created.iconUrl,
      parentId: created.parentId,
      sortOrder: created.sortOrder,
    };
  }

  async updateCategory(id: string, input: Partial<{
    name: Record<string, string>;
    iconUrl: string;
    parentId: string | null;
    sortOrder: number;
  }>) {
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Category not found' });

    const updated = await db.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.iconUrl !== undefined && { iconUrl: input.iconUrl }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      },
    });
    return {
      id: updated.id,
      name: updated.name as Record<string, string>,
      iconUrl: updated.iconUrl,
      parentId: updated.parentId,
      sortOrder: updated.sortOrder,
    };
  }

  async deleteCategory(id: string) {
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Category not found' });
    // 软删除：分类可能被 Product 引用，硬删会丢商品归类
    await db.category.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  // ===== Banner =====

  async listBanners(onlyActive = false) {
    const items = await db.banner.findMany({
      where: onlyActive ? { status: 'ACTIVE' } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return items.map((b) => ({
      id: b.id,
      imageUrl: b.imageUrl,
      alt: b.alt as Record<string, string> | null,
      linkType: b.linkType as 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE',
      linkValue: b.linkValue,
      sortOrder: b.sortOrder,
      status: b.status as 'ACTIVE' | 'INACTIVE',
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    }));
  }

  async createBanner(input: {
    imageUrl: string;
    alt?: Record<string, string> | null;
    linkType: 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE';
    linkValue?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    const created = await db.banner.create({
      data: {
        imageUrl: input.imageUrl,
        alt: (input.alt ?? null) as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue,
        linkType: input.linkType,
        linkValue: input.linkValue ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? 'ACTIVE',
      },
    });
    return {
      id: created.id,
      imageUrl: created.imageUrl,
      alt: created.alt as Record<string, string> | null,
      linkType: created.linkType as 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE',
      linkValue: created.linkValue,
      sortOrder: created.sortOrder,
      status: created.status as 'ACTIVE' | 'INACTIVE',
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async updateBanner(id: string, input: Partial<{
    imageUrl: string;
    alt: Record<string, string> | null;
    linkType: 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE';
    linkValue: string | null;
    sortOrder: number;
    status: 'ACTIVE' | 'INACTIVE';
  }>) {
    const existing = await db.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Banner not found' });

    const updated = await db.banner.update({
      where: { id },
      data: {
        ...(input.imageUrl !== undefined && { imageUrl: input.imageUrl }),
        ...(input.alt !== undefined && { alt: input.alt as Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue }),
        ...(input.linkType !== undefined && { linkType: input.linkType }),
        ...(input.linkValue !== undefined && { linkValue: input.linkValue }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    return {
      id: updated.id,
      imageUrl: updated.imageUrl,
      alt: updated.alt as Record<string, string> | null,
      linkType: updated.linkType as 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE',
      linkValue: updated.linkValue,
      sortOrder: updated.sortOrder,
      status: updated.status as 'ACTIVE' | 'INACTIVE',
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  async deleteBanner(id: string) {
    const existing = await db.banner.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Banner not found' });
    await db.banner.delete({ where: { id } });
  }

  // ===== DTO helpers =====

  /**
   * 批量查询每个商品的默认 SKU id（最低价 ACTIVE SKU）
   *
   * 用于商品列表/推荐场景，避免 N+1 查询。
   * 一次查所有相关 ACTIVE SKU，按 price asc 排序后每个 productId 取第一条。
   *
   * 默认 SKU 选取规则与 recomputeProductPriceMin 一致：最低价 ACTIVE SKU。
   */
  private async batchGetDefaultSkuIds(productIds: string[]): Promise<Map<string, string>> {
    if (productIds.length === 0) return new Map();
    const skus = await db.sku.findMany({
      where: { productId: { in: productIds }, status: 'ACTIVE' },
      orderBy: { price: 'asc' },
      select: { id: true, productId: true },
    });
    const result = new Map<string, string>();
    for (const s of skus) {
      if (!result.has(s.productId)) {
        result.set(s.productId, s.id);
      }
    }
    return result;
  }

  private toProductDTO(p: {
    id: string;
    shopId: string;
    categoryId: string | null;
    name: unknown;
    description: unknown;
    mainImage: string;
    images: string[];
    status: string;
    unit: unknown;
    priceMin: number;
    salesCount: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: p.id,
      shopId: p.shopId,
      categoryId: p.categoryId,
      name: p.name as Record<string, string>,
      description: p.description as Record<string, string> | null,
      mainImage: p.mainImage,
      images: p.images,
      status: p.status as 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK',
      unit: p.unit as Record<string, string>,
      priceMin: p.priceMin,
      salesCount: p.salesCount,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toSkuDTO(s: {
    id: string;
    productId: string;
    name: unknown;
    attributes: unknown;
    price: number;
    imageUrl: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: s.id,
      productId: s.productId,
      name: s.name as Record<string, string>,
      attributes: s.attributes as Record<string, unknown>,
      price: s.price,
      imageUrl: s.imageUrl,
      status: s.status as 'ACTIVE' | 'INACTIVE',
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
