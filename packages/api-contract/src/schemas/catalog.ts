/**
 * Catalog 模块 schema（商品 / SKU / 分类 / Banner）
 *
 * 决策依据：
 * - 契约 v0.3 + W 流程任务（2026-06-24）
 * - 多语言字段（name/description/unit）：i18n JSON Record<string, string>
 * - 金额单位：整数分（Money）
 * - Product.priceMin 由 SKU 聚合（最低价），前端展示用
 */
import { z } from 'zod';
import { Id, IsoTimestamp, I18nText, Money } from './common';

/** 商品状态 */
export const ProductStatus = z.enum(['ACTIVE', 'INACTIVE', 'OUT_OF_STOCK']);

/** SKU 状态 */
export const SkuStatus = z.enum(['ACTIVE', 'INACTIVE']);

/** 商品实体（响应） */
export const Product = z.object({
  id: Id,
  shopId: Id,
  categoryId: Id.nullable(),
  /** 分类名（多语言，B11）。null=无分类。categorySlug 未补（Category 表无 slug 字段） */
  categoryName: I18nText.nullable(),
  name: I18nText,
  description: I18nText.nullable(),
  mainImage: z.string(),
  images: z.array(z.string()),
  status: ProductStatus,
  unit: I18nText,
  priceMin: Money,
  /** 默认 SKU id（最低价 ACTIVE SKU），前端列表"加购物车"直接用 */
  defaultSkuId: Id.nullable(),
  salesCount: z.number().int(),
  /** 库存（聚合全仓库 ACTIVE SKU，B1）。undefined=无库存信息（前端降级），0=断货 */
  stock: z.number().int().optional(),
  /** 评分（B7：聚合 APPROVED reviews 的 AVG(rating)，1 位小数）。undefined=无评论，前端条件渲染隐藏 */
  rating: z.number().optional(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 商品列表简版（首页/搜索用） */
export const ProductSummary = z.object({
  id: Id,
  name: I18nText,
  mainImage: z.string(),
  priceMin: Money,
  /** 默认 SKU id（最低价 ACTIVE SKU），前端列表"加购物车"直接用 */
  defaultSkuId: Id.nullable(),
  status: ProductStatus,
  salesCount: z.number().int(),
  /** 库存（聚合全仓库 ACTIVE SKU，B1）。undefined=无库存信息，0=断货 */
  stock: z.number().int().optional(),
  /** 评分（B7：聚合 APPROVED reviews AVG）。undefined=无评论 */
  rating: z.number().optional(),
});

/** 创建商品请求 */
export const CreateProductRequest = z.object({
  categoryId: Id.nullable().optional(),
  name: I18nText,
  description: I18nText.nullable().optional(),
  mainImage: z.string(),
  images: z.array(z.string()).default([]),
  unit: I18nText,
  status: ProductStatus.optional(),
});

/** 修改商品请求 */
export const UpdateProductRequest = CreateProductRequest.partial();

/** 商品上下架请求 */
export const UpdateProductStatusRequest = z.object({
  status: ProductStatus,
});

/** SKU 实体 */
export const Sku = z.object({
  id: Id,
  productId: Id,
  name: I18nText,
  attributes: z.record(z.string(), z.unknown()),
  price: Money,
  imageUrl: z.string().nullable(),
  status: SkuStatus,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建 SKU 请求 */
export const CreateSkuRequest = z.object({
  name: I18nText,
  attributes: z.record(z.string(), z.unknown()),
  price: Money,
  imageUrl: z.string().nullable().optional(),
  status: SkuStatus.optional(),
});

/** 修改 SKU 请求 */
export const UpdateSkuRequest = CreateSkuRequest.partial();

/** 分类基础字段（叶子节点用，无 children） */
const CategoryBase = z.object({
  id: Id,
  name: I18nText,
  /** W7-ext-A：必须是合法 URL 或空字符串，禁止 emoji 当 iconUrl 写库 */
  iconUrl: z.string().url().or(z.literal('')),
  parentId: Id.nullable(),
  sortOrder: z.number().int(),
  /** 上下架状态（admin 端可见；client 端 service 已过滤 ACTIVE，不返此字段） */
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
/** 分类实体（支持两层：client 端 children 嵌套只含 ACTIVE，admin 端平铺带 parentId 含 INACTIVE） */
export const Category = CategoryBase.extend({
  /** 子分类（client 端 service 组装嵌套；admin 端平铺不返；MVP 锁 2 层，叶子无 children） */
  children: z.array(CategoryBase).optional(),
});

/** 创建分类请求 */
export const CreateCategoryRequest = z.object({
  name: I18nText,
  /** W7-ext-A：必须是合法 URL 或空字符串，禁止 emoji 当 iconUrl 写库 */
  iconUrl: z.string().url().or(z.literal('')),
  parentId: Id.nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/** 修改分类请求（含 status toggle，修现存 admin-web status 写不进库的不一致） */
export const UpdateCategoryRequest = CreateCategoryRequest.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

/** Banner 实体 */
export const Banner = z.object({
  id: Id,
  imageUrl: z.string(),
  alt: I18nText.nullable(),
  linkType: z.enum(['PRODUCT', 'CATEGORY', 'URL', 'NONE']),
  linkValue: z.string().nullable(),
  sortOrder: z.number().int(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 创建 Banner 请求 */
export const CreateBannerRequest = z.object({
  imageUrl: z.string(),
  alt: I18nText.nullable().optional(),
  linkType: z.enum(['PRODUCT', 'CATEGORY', 'URL', 'NONE']),
  linkValue: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

/** 修改 Banner 请求 */
export const UpdateBannerRequest = CreateBannerRequest.partial();
