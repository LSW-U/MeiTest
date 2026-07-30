/**
 * use-banners — 首页轮播图 CRUD hooks（§7.2）
 *
 * 后端：apps/api/src/modules/catalog/catalog.controller.ts AdminBannerController
 *   - GET    /admin/banners          列表
 *   - POST   /admin/banners          新建
 *   - PATCH  /admin/banners/:id      更新
 *   - DELETE /admin/banners/:id      硬删
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export type { I18nText };

export type BannerLinkType = 'PRODUCT' | 'CATEGORY' | 'URL' | 'NONE';

export interface Banner {
  id: string;
  imageUrl: string;
  alt: I18nText | null;
  linkType: BannerLinkType;
  linkValue: string | null;
  sortOrder: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

export interface CreateBannerInput {
  imageUrl: string;
  alt?: I18nText | null;
  linkType: BannerLinkType;
  linkValue?: string | null;
  sortOrder?: number;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface UpdateBannerInput extends Partial<CreateBannerInput> {}

export function useBanners() {
  return useQuery({
    queryKey: ['banners'],
    queryFn: () => apiFetch<ApiSuccess<Banner[]>>('/admin/banners'),
  });
}

export function useCreateBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateBannerInput) =>
      apiFetch<ApiSuccess<Banner>>('/admin/banners', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banners'] }),
  });
}

export function useUpdateBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateBannerInput }) =>
      apiFetch<ApiSuccess<Banner>>(`/admin/banners/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banners'] }),
  });
}

export function useDeleteBanner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/banners/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['banners'] }),
  });
}
