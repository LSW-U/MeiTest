/**
 * use-products — 商品 CRUD hooks
 *
 * 后端：apps/api/src/modules/catalog/catalog.controller.ts
 *   - GET    /admin/products                列表
 *   - GET    /admin/products/:id            详情
 *   - POST   /admin/products                新建
 *   - PATCH  /admin/products/:id            更新
 *   - PATCH  /admin/products/:id/status     上下架
 *   - DELETE /admin/products/:id            删除
 *   - GET    /admin/products/:id/skus       SKU 列表
 *   - POST   /admin/products/:id/skus       新建 SKU
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiUploadFile, type ApiSuccess } from '@/lib/api';

export interface I18nText {
  en?: string;
  zh?: string;
  id?: string;
  pt?: string;
  tet?: string;
}

export interface Product {
  id: string;
  name: I18nText;
  description?: I18nText;
  mainImage?: string;
  images?: string[];
  unit?: I18nText;
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_STOCK';
  priceMin?: number;
  priceMax?: number;
  salesCount?: number;
  categoryId?: string;
  /** 分类名（多语言，后端 adminListProducts 已挂，前端列表展示用） */
  categoryName?: I18nText;
}

export interface CreateProductInput {
  name: I18nText;
  mainImage: string; // 后端契约必填
  unit: I18nText; // 后端契约必填
  description?: I18nText;
  images?: string[];
  status?: 'ACTIVE' | 'INACTIVE';
  categoryId?: string | null;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {}

interface ListParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export function useProducts(params: ListParams = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set('search', params.search);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  const qs = query.toString();
  return useQuery({
    queryKey: ['products', params],
    queryFn: () =>
      apiFetch<ApiSuccess<Product[] | { items: Product[]; total: number; page: number; pageSize: number }>>(
        `/admin/products${qs ? `?${qs}` : ''}`,
      ),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => apiFetch<ApiSuccess<Product>>(`/admin/products/${id}`),
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProductInput) =>
      apiFetch<ApiSuccess<Product>>('/admin/products', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['products'] }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProductInput }) =>
      apiFetch<ApiSuccess<Product>>(`/admin/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', res.data.id] });
    },
  });
}

export function useUpdateProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: Product['status'] }) =>
      apiFetch<ApiSuccess<Product>>(`/admin/products/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', res.data.id] });
    },
  });
}

// ----- 聚合详情（批B：GET /client/products/:id/detail，admin 复用同一公开端点，不筛商品 status）-----

/** 按仓库存条目（批B WarehouseStock） */
export interface WarehouseStockView {
  warehouseId: string;
  name?: I18nText;
  quantity: number;
}

/**
 * 聚合详情（批B ProductDetail 契约镜像）
 * 已知语义（契约注释）：stocks 无记录=空数组、totalStock 恒 number（0=无库存）；
 * isCategoryTop3 非在售商品恒 false（有意设计）
 */
export interface ProductDetailData extends Product {
  /** 按仓库存数组（warehouseId 升序） */
  stocks: WarehouseStockView[];
  /** 全仓库存总量 */
  totalStock: number;
  /** 评分样本数（APPROVED 评论数），0=无评论 */
  ratingCount: number;
  /** 是否同分类销量 Top3（ACTIVE 商品），无分类商品恒 false */
  isCategoryTop3: boolean;
  /** ACTIVE SKU 列表（price 升序） */
  skus: Sku[];
}

export function useProductDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['product-detail', id],
    queryFn: () => apiFetch<ApiSuccess<ProductDetailData>>(`/client/products/${id}/detail`),
    enabled: !!id,
  });
}

// ----- 销量批量调整（批C：PATCH /admin/products/sales-batch，设值语义 + ADMIN_ADJUST 审计）-----

export interface SalesBatchAdjustResult {
  adjusted: string[];
  skipped: string[];
}

export function useAdjustSalesCountBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Array<{ id: string; salesCount: number }>) =>
      apiFetch<ApiSuccess<SalesBatchAdjustResult>>('/admin/products/sales-batch', {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product'] });
      qc.invalidateQueries({ queryKey: ['product-detail'] });
    },
  });
}

// ----- SKU -----

export interface Sku {
  id: string;
  productId: string;
  name: I18nText;
  attributes?: Record<string, string>;
  price: number;
  imageUrl?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface CreateSkuInput {
  name: I18nText;
  attributes?: Record<string, string>;
  price: number;
  imageUrl?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

export function useProductSkus(productId: string | undefined) {
  return useQuery({
    queryKey: ['product-skus', productId],
    queryFn: () => apiFetch<ApiSuccess<Sku[]>>(`/admin/products/${productId}/skus`),
    enabled: !!productId,
  });
}

export function useCreateSku() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: CreateSkuInput }) =>
      apiFetch<ApiSuccess<Sku>>(`/admin/products/${productId}/skus`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) =>
      qc.invalidateQueries({ queryKey: ['product-skus', res.data.productId] }),
  });
}

// ============================================================================
// 批F：商品批量导入（POST /admin/products/import，multipart，全错全不写）
// 后端：apps/api/src/modules/catalog/product-import.controller.ts
// ============================================================================

export type ImportMode = 'skip' | 'overwrite' | 'error';

/** 成功响应（全通过才写库；失败走 400 ApiError.details.failedRows） */
export interface ProductImportResultData {
  successCount: number;
  failedCount: number;
  failedRows: Array<{ line: number; field: string; reason: string }>;
  /** D8 skip 模式被跳过的重复行 */
  skippedRows: Array<{ line: number; key: string }>;
  /** D8 overwrite 模式只覆盖目标仓库存的行 */
  overwrittenRows: Array<{ line: number; key: string }>;
  createdProducts: Array<{ id: string; name: string; skuCode: string | null }>;
  mode: ImportMode;
}

/** 商品批量导入 CSV（multipart file；?mode=skip|overwrite|error 默认 skip） */
export function useImportProductsCsv(mode: ImportMode) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      apiUploadFile<ApiSuccess<ProductImportResultData>>(
        `/admin/products/import?mode=${mode}`,
        file,
        'file',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['import-logs'] }); // 导入历史同步刷新
    },
  });
}
