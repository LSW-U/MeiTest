/**
 * use-riders — 骑手入驻审核 + 列表 hooks
 *
 * 后端：apps/api/src/modules/rider/rider.controller.ts
 *   - GET    /admin/rider-applications           列表（按 applicationStatus 过滤）
 *   - POST   /admin/rider-applications/:id/review 审核（APPROVE/REJECT）
 *
 * 后端响应结构：{ success, data: { items: [...] } }（W4-REVIEW P0-6 修复后前端正确对齐）
 * 字段名：applicationStatus（不是 status，status 是 OFFLINE/ONLINE/BUSY 工作状态）
 *
 * 视角：rider-mgmt（super_admin 专属）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type ApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type RiderWorkStatus = 'OFFLINE' | 'ONLINE' | 'BUSY';
export type VehicleType = 'MOTORCYCLE' | 'BICYCLE' | 'CAR';

/** 后端 RiderProfileView 完整字段（apps/api rider.service.ts toView） */
export interface RiderApplication {
  id: string;
  userId: string;
  riderName: string;
  phone: string;
  vehicleType: VehicleType;
  vehiclePlate: string | null;
  /** 工作状态：OFFLINE/ONLINE/BUSY（与 applicationStatus 区分） */
  status: RiderWorkStatus;
  /** 申请状态：PENDING/APPROVED/REJECTED（审核用） */
  applicationStatus: ApplicationStatus;
  totalDeliveries: number;
  rating: number;
  preferredWarehouseIds: string[];
  isOnline: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListApplicationsResult {
  items: RiderApplication[];
}

export interface ListApplicationsParams {
  /** 注意：后端 query 字段是 status，但语义是 applicationStatus（骑手申请状态） */
  status?: ApplicationStatus;
  limit?: number;
}

export interface ReviewApplicationInput {
  /** 后端 schema 字段：decision（APPROVE/REJECT 大写） */
  decision: 'APPROVED' | 'REJECTED';
  rejectReason?: string;
}

/** 列表 */
export function useRiderApplications(params: ListApplicationsParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.limit) searchParams.set('limit', String(params.limit));
  const query = searchParams.toString();
  return useQuery<ListApplicationsResult>({
    queryKey: ['rider-applications', params],
    queryFn: () =>
      apiFetch<ApiSuccess<ListApplicationsResult>>(
        `/admin/rider-applications${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 审核（APPROVED / REJECTED） */
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
