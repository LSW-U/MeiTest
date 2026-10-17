/**
 * use-segments - 分层运营 hooks（客户画像批2 2026-10-18）
 *
 * 后端：apps/api/src/modules/segment/admin-segment.controller.ts（前缀 /api/v1/admin/marketing/segments）
 *   GET    /dashboard                    RFM 分层看板（D2）
 *   GET    /co-purchase?productId=       买 X 还买 Y 共现（D3）
 *   GET    /repurchase                   分层回购率（D3）
 *   GET    /coupon-attribution/:pid      券归因按层拆解（D4）
 *   GET    /export?stage=&lang=          导出名单 CSV（D7，查看即审计）
 *   POST   /coupons/grant                批量发券（D7，幂等+频控+上限）
 *   CRUD   /coupon-rules                 分层定向券规则（C5）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, API_BASE_URL, type ApiSuccess } from '@/lib/api';
import type { components } from '@meimart/shared-types';

type Schemas = components['schemas'];

export type SegmentStage = Schemas['SegmentBucketRow']['stage'];
export type SegmentDashboard = Schemas['SegmentDashboardData'];
export type CoPurchaseData = Schemas['CoPurchaseData'];
export type SegmentRepurchase = Schemas['SegmentRepurchaseData'];
export type CouponAttribution = Schemas['CouponAttributionData'];
export type BatchGrantResult = Schemas['BatchGrantCouponsData'];
export type SegmentCouponRule = Schemas['SegmentCouponRuleItem'];

/** 全部生命周期层（表头列序） */
export const SEGMENT_STAGES: SegmentStage[] = [
  'NEW',
  'FIRST_PURCHASE',
  'ACTIVE',
  'SLEEPING',
  'CHURNED',
];

/** D2 看板 */
export function useSegmentDashboard() {
  return useQuery<SegmentDashboard>({
    queryKey: ['segments', 'dashboard'],
    queryFn: () =>
      apiFetch<ApiSuccess<SegmentDashboard>>('/admin/marketing/segments/dashboard').then(
        (res) => res.data,
      ),
  });
}

/** D3 分层回购率（与看板同页展示） */
export function useSegmentRepurchase() {
  return useQuery<SegmentRepurchase>({
    queryKey: ['segments', 'repurchase'],
    queryFn: () =>
      apiFetch<ApiSuccess<SegmentRepurchase>>('/admin/marketing/segments/repurchase').then(
        (res) => res.data,
      ),
  });
}

/** D3 共现分析（按 productId 手动触发） */
export function useCoPurchase(productId: string | undefined) {
  return useQuery<CoPurchaseData>({
    queryKey: ['segments', 'co-purchase', productId],
    queryFn: () =>
      apiFetch<ApiSuccess<CoPurchaseData>>(
        `/admin/marketing/segments/co-purchase?productId=${encodeURIComponent(productId!)}`,
      ).then((res) => res.data),
    enabled: !!productId,
  });
}

/** D4 券归因（按 promotionId 手动触发） */
export function useCouponAttribution(promotionId: string | undefined) {
  return useQuery<CouponAttribution>({
    queryKey: ['segments', 'coupon-attribution', promotionId],
    queryFn: () =>
      apiFetch<ApiSuccess<CouponAttribution>>(
        `/admin/marketing/segments/coupon-attribution/${encodeURIComponent(promotionId!)}`,
      ).then((res) => res.data),
    enabled: !!promotionId,
  });
}

/** D7 导出 CSV：cookie 鉴权（httpOnly，credentials: include），blob 下载 */
export async function downloadSegmentCsv(stage: SegmentStage, lang: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/admin/marketing/segments/export?stage=${stage}&lang=${lang}`,
    { credentials: 'include' },
  );
  if (!res.ok) throw new Error(`export failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `segment-${stage.toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** D7 批量发券 */
export function useGrantCoupons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { promotionId: string; userIds: string[] }) =>
      apiFetch<ApiSuccess<BatchGrantResult>>('/admin/marketing/segments/coupons/grant', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['segments'] });
    },
  });
}

/** C5 规则列表 */
export function useSegmentCouponRules() {
  return useQuery<{ items: SegmentCouponRule[] }>({
    queryKey: ['segments', 'coupon-rules'],
    queryFn: () =>
      apiFetch<ApiSuccess<{ items: SegmentCouponRule[] }>>(
        '/admin/marketing/segments/coupon-rules',
      ).then((res) => res.data),
  });
}

function useInvalidateRules() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['segments', 'coupon-rules'] });
}

/** C5 新建规则 */
export function useCreateSegmentCouponRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (input: { stage: SegmentStage; promotionId: string; enabled?: boolean }) =>
      apiFetch<ApiSuccess<SegmentCouponRule>>('/admin/marketing/segments/coupon-rules', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: invalidate,
  });
}

/** C5 编辑规则 */
export function useUpdateSegmentCouponRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      stage?: SegmentStage;
      promotionId?: string;
      enabled?: boolean;
    }) =>
      apiFetch<ApiSuccess<SegmentCouponRule>>(
        `/admin/marketing/segments/coupon-rules/${id}`,
        { method: 'PATCH', body: JSON.stringify(input) },
      ).then((res) => res.data),
    onSuccess: invalidate,
  });
}

/** C5 删除规则 */
export function useDeleteSegmentCouponRule() {
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/marketing/segments/coupon-rules/${id}`, {
        method: 'DELETE',
      }).then((res) => res.data),
    onSuccess: invalidate,
  });
}
