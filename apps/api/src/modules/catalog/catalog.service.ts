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

    // 子分类适配：categoryId 是大类（有子分类）-> 返大类+所有子分类商品；叶子 -> 返自身
    let categoryIdFilter: { in: string[] } | undefined;
    if (opts.categoryId) {
      const children = await db.category.findMany({
        where: { parentId: opts.categoryId },
        select: { id: true },
      });
      categoryIdFilter = { in: [opts.categoryId, ...children.map((c) => c.id)] };
    }

    const where: Prisma.ProductWhereInput = {
      ...(opts.status && { status: opts.status }),
      ...(!opts.status && { status: 'ACTIVE' }), // 默认 ACTIVE
      ...(categoryIdFilter && { categoryId: categoryIdFilter }),
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

    const [defaultSkuMap, stockMap, ratingMap, categoryMap] = await Promise.all([
      this.batchGetDefaultSkuIds(items.map((p) => p.id)),
      this.batchGetProductStock(items.map((p) => p.id)),
      this.batchGetProductRating(items.map((p) => p.id)),
      this.batchGetCategoryNameMap(items.map((p) => p.categoryId)),
    ]);

    return {
      items: items.map((p) => ({
        ...this.toProductDTO(p),
        defaultSkuId: defaultSkuMap.get(p.id) ?? null,
        stock: stockMap.get(p.id),
        rating: ratingMap.get(p.id),
        categoryName: p.categoryId ? (categoryMap.get(p.categoryId) ?? null) : null,
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
    const [stockMap, ratingMap, categoryMap] = await Promise.all([
      this.batchGetProductStock([id]),
      this.batchGetProductRating([id]),
      this.batchGetCategoryNameMap([product.categoryId]),
    ]);
    return {
      ...this.toProductDTO(product),
      defaultSkuId: product.skus[0]?.id ?? null,
      stock: stockMap.get(id),
      rating: ratingMap.get(id),
      categoryName: product.categoryId ? (categoryMap.get(product.categoryId) ?? null) : null,
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
    const [defaultSkuMap, stockMap, ratingMap, categoryMap] = await Promise.all([
      this.batchGetDefaultSkuIds(items.map((p) => p.id)),
      this.batchGetProductStock(items.map((p) => p.id)),
      this.batchGetProductRating(items.map((p) => p.id)),
      this.batchGetCategoryNameMap(items.map((p) => p.categoryId)),
    ]);
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
      stock: stockMap.get(p.id),
      rating: ratingMap.get(p.id),
      categoryName: p.categoryId ? (categoryMap.get(p.categoryId) ?? null) : null,
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
    const [defaultSkuMap, stockMap, ratingMap, categoryMap] = await Promise.all([
      this.batchGetDefaultSkuIds(items.map((p) => p.id)),
      this.batchGetProductStock(items.map((p) => p.id)),
      this.batchGetProductRating(items.map((p) => p.id)),
      this.batchGetCategoryNameMap(items.map((p) => p.categoryId)),
    ]);
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
      stock: stockMap.get(p.id),
      rating: ratingMap.get(p.id),
      categoryName: p.categoryId ? (categoryMap.get(p.categoryId) ?? null) : null,
    }));
  }

  // ===== 后台：商品 CRUD =====

  async adminListProducts(status?: string) {
    const items = await db.product.findMany({
      where: status ? { status: status as ProductStatus } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    const [defaultSkuMap, stockMap, ratingMap, categoryMap] = await Promise.all([
      this.batchGetDefaultSkuIds(items.map((p) => p.id)),
      this.batchGetProductStock(items.map((p) => p.id)),
      this.batchGetProductRating(items.map((p) => p.id)),
      this.batchGetCategoryNameMap(items.map((p) => p.categoryId)),
    ]);
    return items.map((p) => ({
      ...this.toProductDTO(p),
      defaultSkuId: defaultSkuMap.get(p.id) ?? null,
      stock: stockMap.get(p.id),
      rating: ratingMap.get(p.id),
      categoryName: p.categoryId ? (categoryMap.get(p.categoryId) ?? null) : null,
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

  /** 客户端商品规格列表（B6，只返 ACTIVE SKU，供规格选择器） */
  async listClientSkusByProduct(productId: string) {
    const skus = await db.sku.findMany({
      where: { productId, status: 'ACTIVE' },
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

  /** client：返两层嵌套树，只含 ACTIVE，按 sortOrder + id 排（删 name:'asc' JSONB 可疑排序） */
  async listCategoryTree() {
    const items = await db.category.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return this.buildCategoryTree(items);
  }

  /** admin：返平铺带 parentId（含 INACTIVE + status），前端组装树做 CRUD */
  async listCategoriesAdmin() {
    const items = await db.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return items.map((c) => ({
      id: c.id,
      name: c.name as Record<string, string>,
      iconUrl: c.iconUrl,
      parentId: c.parentId,
      sortOrder: c.sortOrder,
      status: c.status as 'ACTIVE' | 'INACTIVE',
    }));
  }

  /** 平铺 -> 两层嵌套（MVP 锁 2 层：roots + 直接 children，不递归；client tree 不返 status） */
  private buildCategoryTree(rows: Array<{
    id: string;
    name: unknown;
    iconUrl: string;
    parentId: string | null;
    sortOrder: number;
  }>) {
    const toNode = (c: { id: string; name: unknown; iconUrl: string; parentId: string | null; sortOrder: number }) => ({
      id: c.id,
      name: c.name as Record<string, string>,
      iconUrl: c.iconUrl,
      parentId: c.parentId,
      sortOrder: c.sortOrder,
    });
    const roots = rows.filter((r) => !r.parentId);
    return roots.map((r) => ({
      ...toNode(r),
      children: rows.filter((c) => c.parentId === r.id).map(toNode),
    }));
  }

  async createCategory(input: {
    name: Record<string, string>;
    iconUrl: string;
    parentId?: string | null;
    sortOrder?: number;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    if (input.parentId) {
      const parent = await db.category.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new BadRequestException({ code: 'E-CATALOG-010', message: 'Parent category not found' });
      // MVP 锁 2 层：parent 必须是顶级（parentId = null）
      if (parent.parentId) throw new BadRequestException({ code: 'E-CATALOG-011', message: 'Only 2 levels supported' });
    }
    const created = await db.category.create({
      data: {
        name: input.name,
        iconUrl: input.iconUrl,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder ?? 0,
        status: (input.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      },
    });
    return {
      id: created.id,
      name: created.name as Record<string, string>,
      iconUrl: created.iconUrl,
      parentId: created.parentId,
      sortOrder: created.sortOrder,
      status: created.status as 'ACTIVE' | 'INACTIVE',
    };
  }

  async updateCategory(id: string, input: Partial<{
    name: Record<string, string>;
    iconUrl: string;
    parentId: string | null;
    sortOrder: number;
    status: 'ACTIVE' | 'INACTIVE';
  }>) {
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Category not found' });

    if (input.parentId !== undefined && input.parentId !== null) {
      if (input.parentId === id) throw new BadRequestException({ code: 'E-CATALOG-012', message: 'Cannot set self as parent' });
      const parent = await db.category.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new BadRequestException({ code: 'E-CATALOG-010', message: 'Parent category not found' });
      if (parent.parentId) throw new BadRequestException({ code: 'E-CATALOG-011', message: 'Only 2 levels supported' });
      // 该分类已有子分类，不能再挂为别人子分类（避免变 3 层）
      const childCount = await db.category.count({ where: { parentId: id } });
      if (childCount > 0) throw new BadRequestException({ code: 'E-CATALOG-013', message: 'Has subcategories, cannot become subcategory' });
    }

    const updated = await db.category.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.iconUrl !== undefined && { iconUrl: input.iconUrl }),
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...(input.status !== undefined && { status: input.status }),
      },
    });
    return {
      id: updated.id,
      name: updated.name as Record<string, string>,
      iconUrl: updated.iconUrl,
      parentId: updated.parentId,
      sortOrder: updated.sortOrder,
      status: updated.status as 'ACTIVE' | 'INACTIVE',
    };
  }

  async deleteCategory(id: string) {
    const existing = await db.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: 'E-CATALOG-001', message: 'Category not found' });
    // 子分类保护：有 ACTIVE 子分类时禁止删（先删子分类）
    const childCount = await db.category.count({ where: { parentId: id, status: 'ACTIVE' } });
    if (childCount > 0) throw new BadRequestException({ code: 'E-CATALOG-014', message: 'Please delete subcategories first' });
    // 商品保护：有在售商品引用该分类时禁止删（避免商品孤儿/幽灵分类名，审查建议 2）
    const productCount = await db.product.count({ where: { categoryId: id, status: 'ACTIVE' } });
    if (productCount > 0) throw new BadRequestException({ code: 'E-CATALOG-015', message: 'Category has active products, cannot delete' });
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
  /**
   * 批量查询每个商品的库存总量（B1：聚合 Stock 表，全仓库所有 ACTIVE SKU 求和）
   *
   * 用于商品列表/详情/推荐，避免 N+1。一次查所有相关 ACTIVE SKU 的 Stock，按 productId 求和。
   * 只返回有 Stock 记录的 productId；无记录的商品不在 Map 中（前端按 stock=undefined "无库存信息"降级）。
   * 注：stock 是跨仓库聚合的展示值；真实可购数量以下单时按地址匹配仓库后的校验为准。
   */
  private async batchGetProductStock(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const stocks = await db.stock.findMany({
      where: { sku: { productId: { in: productIds }, status: 'ACTIVE' } },
      select: { quantity: true, sku: { select: { productId: true } } },
    });
    const map = new Map<string, number>();
    for (const s of stocks) {
      const pid = s.sku.productId;
      map.set(pid, (map.get(pid) ?? 0) + s.quantity);
    }
    return map;
  }

  /**
   * 批量查询每个商品的评分（B7：聚合 APPROVED reviews 的 AVG(rating)）
   *
   * 用于商品列表/详情评分展示，避免 N+1。只返有 APPROVED 评论的 productId；
   * 无评论的不在 Map 中（前端 rating=undefined 条件渲染隐藏）。
   */
  private async batchGetProductRating(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await db.review.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, status: 'APPROVED' },
      _avg: { rating: true },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.productId && r._avg.rating != null) {
        map.set(r.productId, Number(r._avg.rating.toFixed(1)));
      }
    }
    return map;
  }

  /**
   * 批量查询 categoryId -> 多语言分类名 map（B11：商品 DTO 补 categoryName）
   *
   * 解决前端拿 categoryId(uuid) 无法显示分类名的问题。categorySlug 未补（Category 表无 slug 字段，
   * 加需 migration+回填；B6 已提供真实 SKU 端点绕过 variantTemplates 按 slug 匹配）。
   */
  private async batchGetCategoryNameMap(
    categoryIds: (string | null)[],
  ): Promise<Map<string, Record<string, string>>> {
    const validIds = [...new Set(categoryIds.filter((id): id is string => id !== null))];
    if (validIds.length === 0) return new Map();
    const cats = await db.category.findMany({
      where: { id: { in: validIds } },
      select: { id: true, name: true },
    });
    const map = new Map<string, Record<string, string>>();
    for (const c of cats) map.set(c.id, c.name as Record<string, string>);
    return map;
  }

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
