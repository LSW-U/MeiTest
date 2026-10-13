/**
 * use-onboarding-slides — 引导页轮播配置 CRUD hooks（引导页内容可配置 · 批2）
 *
 * 后端：apps/api onboarding 模块（批1 落地）
 *   - GET    /admin/onboarding/slides        列表（sortOrder 升序）
 *   - POST   /admin/onboarding/slides        新建
 *   - PATCH  /admin/onboarding/slides/:id    更新（含排序/启停）
 *   - DELETE /admin/onboarding/slides/:id    删除
 *
 * 权限：SUPER_ADMIN JWT（与批1 一致）。客户端匿名走 GET /client/onboarding/slides（不在本层）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export type { I18nText };

/** 引导页轮播项（契约约定见任务书批2「契约约定」，以批1 落地契约为准回改） */
export interface OnboardingSlide {
  id: string;
  /** Material Symbol 图标名（可选） */
  icon?: string | null;
  /** 轮播图 URL（可选，slide-image 场景上传） */
  imageUrl?: string | null;
  /** 标题五语（en/pt/tet/id/zh，en 必填其余可空回退 en） */
  title: I18nText;
  /** 描述五语（同上） */
  description: I18nText;
  /** 排序值（小在前） */
  sortOrder: number;
  /** 启停 */
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOnboardingSlideInput {
  icon?: string | null;
  imageUrl?: string | null;
  title: I18nText;
  description: I18nText;
  sortOrder?: number;
  enabled?: boolean;
}

export type UpdateOnboardingSlideInput = Partial<CreateOnboardingSlideInput>;

export function useOnboardingSlides() {
  return useQuery({
    queryKey: ['onboarding-slides'],
    queryFn: () => apiFetch<ApiSuccess<OnboardingSlide[]>>('/admin/onboarding/slides'),
  });
}

export function useCreateOnboardingSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOnboardingSlideInput) =>
      apiFetch<ApiSuccess<OnboardingSlide>>('/admin/onboarding/slides', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-slides'] }),
  });
}

export function useUpdateOnboardingSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateOnboardingSlideInput }) =>
      apiFetch<ApiSuccess<OnboardingSlide>>(`/admin/onboarding/slides/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-slides'] }),
  });
}

export function useDeleteOnboardingSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/onboarding/slides/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['onboarding-slides'] }),
  });
}
