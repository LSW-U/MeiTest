/**
 * use-riders — 骑手入驻审核 + 列表 hooks
 *
 * 后端：apps/api/src/modules/rider/rider.controller.ts
 *   - GET    /admin/rider-applications           列表（按 status 过滤）
 *   - POST   /admin/rider-applications/:id/review 审核（approve/reject）
 *
 * 视角：rider-mgmt（super_admin 专属）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface RiderApplication {
  id: string;
  userId: string;
  riderName: string;
  phone: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate: string | null;
  idCardNumber: string | null;
  status: ApplicationStatus;
  rejectReason?: string | null;
  reviewedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListApplicationsParams {
  status?: ApplicationStatus;
  limit?: number;
}

export interface ReviewApplicationInput {
  action: 'approve' | 'reject';
  rejectReason?: string;
}

/** 列表 */
export function useRiderApplications(params: ListApplicationsParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return useQuery<RiderApplication[]>({
    queryKey: ['rider-applications', params],
    queryFn: () =>
      apiFetch<ApiSuccess<RiderApplication[]>>(
        `/admin/rider-applications${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 审核（approve / reject） */
export function useReviewApplication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReviewApplicationInput }) =>
      apiFetch<ApiSuccess<RiderApplication>>(
        `/admin/rider-applications/${id}/review`,
        { method: 'POST', body: JSON.stringify(input) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rider-applications'] });
    },
  });
}
