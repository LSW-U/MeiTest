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
import { apiFetch, type ApiSuccess } from '@/lib/api';

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
}

export interface CreateProductInput {
  name: I18nText;
  mainImage: string; // 后端契约必填
  unit: I18nText; // 后端契约必填
  description?: I18nText;
  images?: string[];
  status?: 'ACTIVE' | 'INACTIVE';
  categoryId?: string;
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
