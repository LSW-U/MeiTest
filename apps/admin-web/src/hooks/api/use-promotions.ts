/**
 * use-promotions - 促销管理 hooks（W7-ext-G）
 *
 * 后端 7 endpoints（/api/v1/admin/promotions）：
 *   GET    /                       列表
 *   GET    /:id                       详情
 *   POST   /                          创建
 *   PATCH  /:id                       编辑
 *   POST   /:id/activate              激活
 *   POST   /:id/pause                 暂停
 *   POST   /:id/delete                软删
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type PromotionType = 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_DELIVERY';
export type PromotionStatus = 'ACTIVE' | 'PAUSED' | 'DELETED';

export interface Promotion {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: PromotionType;
  value: number;
  minOrderAmount: number;
  maxDiscountAmount: number | null;
  totalQuota: number | null;
  usedCount: number;
  perUserLimit: number;
  startAt: string;
  endAt: string;
  status: PromotionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePromotionInput {
  code: string;
  name: string;
  description?: string;
  type: PromotionType;
  value: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  totalQuota?: number | null;
  perUserLimit?: number;
  startAt: string;
  endAt: string;
}

export interface UpdatePromotionInput {
  name?: string;
  description?: string | null;
  value?: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number | null;
  totalQuota?: number | null;
  perUserLimit?: number;
  startAt?: string;
  endAt?: string;
}

export interface ListPromotionsParams {
  status?: PromotionStatus;
  type?: PromotionType;
  keyword?: string;
  limit?: number;
}

function buildQueryString(params: ListPromotionsParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.type) sp.set('type', params.type);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.limit) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function usePromotions(params: ListPromotionsParams = {}) {
  return useQuery({
    queryKey: ['promotions', params],
    queryFn: async () => {
      const qs = buildQueryString(params);
      const res = await apiFetch<ApiSuccess<Promotion[]>>(`/admin/promotions${qs}`);
      return res.data;
    },
  });
}

export function useCreatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePromotionInput) =>
      apiFetch<ApiSuccess<Promotion>>('/admin/promotions', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });
}

export function useUpdatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePromotionInput }) =>
      apiFetch<ApiSuccess<Promotion>>(`/admin/promotions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });
}

export function useActivatePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<Promotion>>(`/admin/promotions/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });
}

export function usePausePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<Promotion>>(`/admin/promotions/${id}/pause`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });
}

export function useDeletePromotion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; status: string }>>(`/admin/promotions/${id}/delete`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promotions'] });
    },
  });
}
