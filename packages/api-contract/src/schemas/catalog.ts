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

/** 分类实体（平铺，前端按 parentId 组装树形） */
export const Category = z.object({
  id: Id,
  name: I18nText,
  /** W7-ext-A：必须是合法 URL 或空字符串，禁止 emoji 当 iconUrl 写库 */
  iconUrl: z.string().url().or(z.literal('')),
  parentId: Id.nullable(),
  sortOrder: z.number().int(),
});

/** 创建分类请求 */
export const CreateCategoryRequest = z.object({
  name: I18nText,
  /** W7-ext-A：必须是合法 URL 或空字符串，禁止 emoji 当 iconUrl 写库 */
  iconUrl: z.string().url().or(z.literal('')),
  parentId: Id.nullable().optional(),
  sortOrder: z.number().int().optional(),
});

/** 修改分类请求 */
export const UpdateCategoryRequest = CreateCategoryRequest.partial();

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
