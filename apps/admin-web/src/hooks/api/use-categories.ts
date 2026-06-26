/**
 * use-categories — 商品分类 CRUD hooks
 *
 * 后端：apps/api/src/modules/catalog/catalog.controller.ts
 *   - GET    /admin/categories          列表（AdminCategoryController）
 *   - POST   /admin/categories          新建
 *   - PATCH  /admin/categories/:id      更新
 *   - DELETE /admin/categories/:id      删除
 *
 * 路径说明：分类是独立的 endpoint（不在 /admin/products 下面），无 route ordering 风险。
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
