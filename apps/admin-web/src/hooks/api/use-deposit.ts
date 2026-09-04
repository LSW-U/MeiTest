/**
 * Deposit hooks — 保证金 + 派单候选（批 E，2026-09-03）
 *
 * 后端（批 C/D 契约）：
 *   GET    /admin/deposit/tiers                                 档位列表
 *   POST   /admin/deposit/tiers                                 新增档位
 *   PATCH  /admin/deposit/tiers/:id                             编辑档位
 *   DELETE /admin/deposit/tiers/:id                             软停用
 *   GET    /admin/deposit/locations                             缴纳点列表
 *   POST   /admin/deposit/locations                             新增缴纳点
 *   PATCH  /admin/deposit/locations/:id                         编辑缴纳点
 *   DELETE /admin/deposit/locations/:id                         软停用
 *   GET    /admin/deposit/requests?status=&page=&pageSize=      申请列表（分页）
 *   POST   /admin/deposit/requests/:id/confirm                  确认收款
 *   POST   /admin/deposit/requests/:id/reject                   拒绝
 *   GET    /admin/riders/:id/detail                             骑手聚合详情（①-⑤）
 *   GET    /admin/dispatch/warehouse-load                       各仓负载
 *   GET    /admin/dispatch/tasks/:id/candidates                 派单候选（批 D）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

// ===== 类型（与 packages/api-contract/src/schemas/rider.ts 批 B/C/D 同步） =====

export interface RiderDepositTier {
  id: string;
  minAmount: number;
  maxOrderAmount: number | null;
  sortOrder: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DepositLocation {
  id: string;
  name: string;
  address: string;
  note: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RiderDepositRequestItem {
  id: string;
  channel: 'ONLINE_MOCK' | 'OFFLINE_COD';
  requestedAmount: number;
  confirmedAmount: number | null;
  status: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED';
  locationId: string | null;
  note: string | null;
  adminNote: string | null;
  createdAt: string;
  paidAt: string | null;
  confirmedAt: string | null;
  riderName: string;
  riderPhone: string;
  locationName: string | null;
}

export interface DepositRequestListParams {
  status?: 'PENDING' | 'CONFIRMED' | 'REJECTED' | 'REFUNDED';
  page?: number;
  pageSize?: number;
}

export interface DepositRequestListResult {
  items: RiderDepositRequestItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 骑手聚合详情（批 C Q8 ①-⑤） */
export interface RiderDepositDetail {
  basic: {
    riderProfileId: string;
    userId: string;
    riderName: string;
    phone: string;
    vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
    vehiclePlate: string | null;
    applicationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    preferredWarehouseIds: string[];
  };
  realtime: {
    status: 'OFFLINE' | 'ONLINE' | 'BUSY';
    isOnline: boolean;
    maybeOffline: boolean;
    activeTaskCount: number;
  };
  stats: {
    todayDeliveries: number;
    totalDeliveries: number;
    rating: number;
  };
  finance: {
    depositAmount: number;
    tier: RiderDepositTier | null;
    maxOrderAmount: number | null;
    settleBalance: number;
  };
  depositRequests: RiderDepositRequestItem[];
}

/** 各仓负载（批 C #7） */
export interface WarehouseLoadItem {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string | null;
  pendingTaskCount: number;
  availableRiderCount: number;
  estWaitMinutes: number;
}

/** 派单候选（批 D） */
export interface DispatchCandidate {
  riderProfileId: string;
  riderName: string;
  phone: string;
  vehicleType: 'MOTORCYCLE' | 'BICYCLE' | 'CAR';
  isOnline: boolean;
  rating: number;
  depositAmount: number;
  maxOrderAmount: number | null;
  inTransitTasks: number;
  distanceKm: number | null;
  eligibility: {
    eligible: boolean;
    depositAmount: number;
    maxOrderAmount: number | null;
    requiredDeposit?: number;
  };
  warehouseMatched: boolean;
  score: number;
}

export interface DispatchCandidateList {
  taskId: string;
  orderAmount: number;
  items: DispatchCandidate[];
}

export interface DispatchCandidateParams {
  taskId: string;
  crossWarehouse?: boolean;
  includeIneligible?: boolean;
}

// ===== tiers CRUD =====

export function useDepositTiers() {
  return useQuery({
    queryKey: ['deposit-tiers'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<RiderDepositTier[]>>('/admin/deposit/tiers');
      return res.data;
    },
  });
}

export interface UpsertTierInput {
  minAmount?: number;
  maxOrderAmount?: number | null;
  sortOrder?: number;
  enabled?: boolean;
}

export function useCreateTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertTierInput) =>
      apiFetch<ApiSuccess<RiderDepositTier>>('/admin/deposit/tiers', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-tiers'] });
    },
  });
}

export function useUpdateTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpsertTierInput }) =>
      apiFetch<ApiSuccess<RiderDepositTier>>(`/admin/deposit/tiers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-tiers'] });
    },
  });
}

export function useDeleteTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; enabled: false }>>(`/admin/deposit/tiers/${id}`, {
        method: 'DELETE',
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-tiers'] });
    },
  });
}

// ===== locations CRUD =====

export function useDepositLocations() {
  return useQuery({
    queryKey: ['deposit-locations'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<DepositLocation[]>>('/admin/deposit/locations');
      return res.data;
    },
  });
}

export interface UpsertLocationInput {
  name?: string;
  address?: string;
  note?: string | null;
  enabled?: boolean;
}

export function useCreateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertLocationInput) =>
      apiFetch<ApiSuccess<DepositLocation>>('/admin/deposit/locations', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-locations'] });
    },
  });
}

export function useUpdateLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpsertLocationInput }) =>
      apiFetch<ApiSuccess<DepositLocation>>(`/admin/deposit/locations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-locations'] });
    },
  });
}

export function useDeleteLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; enabled: false }>>(`/admin/deposit/locations/${id}`, {
        method: 'DELETE',
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-locations'] });
    },
  });
}

// ===== 申请列表 + confirm/reject =====

export function useDepositRequests(params: DepositRequestListParams = {}) {
  return useQuery({
    queryKey: ['deposit-requests', params],
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params.status) sp.set('status', params.status);
      if (params.page) sp.set('page', String(params.page));
      if (params.pageSize) sp.set('pageSize', String(params.pageSize));
      const qs = sp.toString();
      const res = await apiFetch<ApiSuccess<DepositRequestListResult>>(
        `/admin/deposit/requests${qs ? `?${qs}` : ''}`,
      );
      return res.data;
    },
  });
}

export function useConfirmDepositRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      confirmedAmount,
      adminNote,
    }: {
      id: string;
      confirmedAmount?: number;
      adminNote?: string;
    }) =>
      apiFetch<ApiSuccess<{ deposit: RiderDepositRequestItem; depositAmount: number }>>(
        `/admin/deposit/requests/${id}/confirm`,
        { method: 'POST', body: JSON.stringify({ confirmedAmount, adminNote }) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-requests'] });
      qc.invalidateQueries({ queryKey: ['rider-deposit-detail'] });
    },
  });
}

export function useRejectDepositRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote: string }) =>
      apiFetch<ApiSuccess<RiderDepositRequestItem>>(`/admin/deposit/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ adminNote }),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deposit-requests'] });
      qc.invalidateQueries({ queryKey: ['rider-deposit-detail'] });
    },
  });
}

// ===== 骑手聚合详情 =====

export function useRiderDepositDetail(id: string | null) {
  return useQuery({
    queryKey: ['rider-deposit-detail', id],
    enabled: id !== null,
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<RiderDepositDetail>>(`/admin/riders/${id}/detail`);
      return res.data;
    },
  });
}

// ===== 仓负载 =====

export function useWarehouseLoad() {
  return useQuery({
    queryKey: ['warehouse-load'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<WarehouseLoadItem[]>>('/admin/dispatch/warehouse-load');
      return res.data;
    },
    // 派单面板场景：30s 轮询保鲜（与任务监控一致的低频刷新）
    refetchInterval: 30_000,
  });
}

// ===== 派单候选（批 D） =====

export function useDispatchCandidates(params: DispatchCandidateParams | null) {
  return useQuery({
    queryKey: ['dispatch-candidates', params?.taskId, params?.crossWarehouse, params?.includeIneligible],
    enabled: params !== null,
    queryFn: async () => {
      const sp = new URLSearchParams();
      if (params?.crossWarehouse) sp.set('crossWarehouse', 'true');
      if (params?.includeIneligible) sp.set('includeIneligible', 'true');
      const qs = sp.toString();
      const res = await apiFetch<ApiSuccess<DispatchCandidateList>>(
        `/admin/dispatch/tasks/${params!.taskId}/candidates${qs ? `?${qs}` : ''}`,
      );
      return res.data;
    },
  });
}
