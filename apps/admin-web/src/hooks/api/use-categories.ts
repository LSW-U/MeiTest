/**
 * use-categories — 商品分类 CRUD hooks
 *
 * 后端：apps/api/src/modules/catalog/catalog.controller.ts
 *   - GET    /admin/products/categories           列表（树/平铺）
 *   - POST   /admin/products/categories           新建
 *   - PATCH  /admin/categories/:id                更新（注意：路径切换到 /admin/categories）
 *   - DELETE /admin/categories/:id                删除
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
  iconUrl?: string;
  parentId?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {
  status?: 'ACTIVE' | 'INACTIVE';
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiFetch<ApiSuccess<Category[]>>('/admin/products/categories'),
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCategoryInput) =>
      apiFetch<ApiSuccess<Category>>('/admin/products/categories', {
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
