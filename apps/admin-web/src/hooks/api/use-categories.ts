/**
 * use-categories — 商品分类 CRUD hooks
 *
 * 后端：apps/api/src/modules/catalog/catalog.controller.ts
 *   - GET    /admin/categories                列表（不走 /admin/products/categories，会被 :id 拦截）
 *   - POST   /admin/products/categories       新建
 *   - PATCH  /admin/categories/:id            更新
 *   - DELETE /admin/categories/:id            删除
 *
 * ⚠️ 后端 route ordering bug：AdminProductController 上同时有 @Get(':id') 和 @Get('categories')，
 *    NestJS 优先匹配 :id，导致 GET /admin/products/categories 被当作 productId 处理（返回 E-CATALOG-001）。
 *    临时方案：list 走 /admin/categories（AdminCatalogController）；create/update/delete 也走 /admin/categories。
 *    后端修复建议：将 @Get('categories') 移到 @Get(':id') 之前，或重命名为不冲突的路径。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export type { I18nText };

export interface Category {
  id: string;
  name: I18nText;
  iconUrl?: string;
  parentId?: string | null;
  sortOrder?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface CreateCategoryInput {
  name: I18nText;
  iconUrl: string; // 后端契约必填
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {
  status?: 'ACTIVE' | 'INACTIVE';
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<ApiSuccess<Category[]>>('/admin/categories'),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<ApiSuccess<Category>>('/admin/categories', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCategoryInput }) =>
      apiFetch<ApiSuccess<Category>>(`/admin/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/categories/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}
