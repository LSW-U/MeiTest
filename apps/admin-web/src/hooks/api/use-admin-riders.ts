/**
 * Admin Rider hooks - /riders CRUD（W7-ext-D）
 *
 * 后端 6 endpoints（/api/v1/admin/riders）：
 *   GET    /                       列表
 *   GET    /:id                       详情
 *   PATCH  /:id                       编辑
 *   POST   /:id/suspend               停用
 *   POST   /:id/activate              恢复
 *   POST   /:id/delete                软删
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export interface AdminRiderListItem {
  id: string;
  userId: string;
  riderName: string;
  phone: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate: string | null;
  status: 'OFFLINE' | 'ONLINE' | 'BUSY';
  applicationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  totalDeliveries: number;
  rating: number;
  preferredWarehouseIds: string[];
  isOnline: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminRiderDetail extends AdminRiderListItem {
  userStatus: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  idCardNumber: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  recentOrders: Array<{
    id: string;
    orderNo: string;
    status: string;
    payableAmount: number;
    createdAt: string;
  }>;
}

export interface UpdateAdminRiderInput {
  vehicleType?: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  vehiclePlate?: string | null;
  preferredWarehouseIds?: string[];
}

export interface AdminRiderListParams {
  status?: 'OFFLINE' | 'ONLINE' | 'BUSY';
  userStatus?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  keyword?: string;
  warehouseId?: string;
  limit?: number;
}

function buildQueryString(params: AdminRiderListParams): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.userStatus) sp.set('userStatus', params.userStatus);
  if (params.keyword) sp.set('keyword', params.keyword);
  if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
  if (params.limit) sp.set('limit', String(params.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useAdminRiders(params: AdminRiderListParams = {}) {
  return useQuery({
    queryKey: ['admin-riders', params],
    queryFn: async () => {
      const qs = buildQueryString(params);
      const res = await apiFetch<ApiSuccess<AdminRiderListItem[]>>(`/admin/riders${qs}`);
      return res.data;
    },
  });
}

export function useAdminRiderDetail(id: string | null) {
  return useQuery({
    queryKey: ['admin-riders', 'detail', id],
    enabled: id !== null,
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<AdminRiderDetail>>(`/admin/riders/${id}`);
      return res.data;
    },
  });
}

export function useUpdateAdminRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAdminRiderInput }) =>
      apiFetch<ApiSuccess<AdminRiderListItem>>(`/admin/riders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-riders'] });
    },
  });
}

export function useSuspendRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; userStatus: string; riderStatus: string }>>(
        `/admin/riders/${id}/suspend`,
        { method: 'POST', body: JSON.stringify({}) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-riders'] });
    },
  });
}

export function useActivateRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; userStatus: string }>>(
        `/admin/riders/${id}/activate`,
        { method: 'POST', body: JSON.stringify({}) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-riders'] });
    },
  });
}

export function useDeleteRider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiFetch<ApiSuccess<{ id: string; userStatus: string }>>(
        `/admin/riders/${id}/delete`,
        { method: 'POST', body: JSON.stringify({ reason: reason ?? '' }) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-riders'] });
    },
  });
}
