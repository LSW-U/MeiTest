/**
 * use-dispatch — 配送调度管理 hooks（admin 视角，批次 4）
 *
 * 后端：apps/api/src/modules/dispatch/admin-dispatch.controller.ts
 *   - GET    /admin/dispatch/tasks                    列表（游标分页 + filter）
 *   - GET    /admin/dispatch/tasks/:id                详情（含 order + rider）
 *   - POST   /admin/dispatch/tasks/:id/reassign       改派（SUPER_ADMIN；ASSIGNED only）
 *   - POST   /admin/dispatch/tasks/:id/cancel         取消（SUPER_ADMIN；PENDING_ASSIGN/ASSIGNED）
 *   - GET    /admin/dispatch/riders/available         可派骑手（APPROVED + isOnline）
 *   - POST   /admin/dispatch/orders/:orderId/recreate 补建（SUPER_ADMIN；幂等）
 *
 * 权限：读 SUPER_ADMIN+CUSTOMER_SERVICE；写仅 SUPER_ADMIN
 */
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type DeliveryTaskStatus =
  | 'PENDING_ASSIGN'
  | 'ASSIGNED'
  | 'PICKED_UP'
  | 'DELIVERING'
  | 'DELIVERED'
  | 'FAILED';

export type VehicleType = 'BICYCLE' | 'MOTORCYCLE' | 'CAR';

export interface TaskOrderSummary {
  orderNo: string;
  status: string;
  payableAmount: number | null;
  paymentMethod: string;
}

export interface TaskRiderSummary {
  id: string;
  riderName: string;
  phone: string;
}

export interface AdminDeliveryTask {
  id: string;
  orderId: string;
  riderId: string | null;
  warehouseId: string;
  status: DeliveryTaskStatus;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  estimatedArrival: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  warehouseCode: string;
  order: TaskOrderSummary;
  rider: TaskRiderSummary | null;
}

export interface AvailableRider {
  id: string;
  riderName: string;
  phone: string;
  vehicleType: VehicleType;
  isOnline: boolean;
  totalDeliveries: number;
  rating: number;
}

export interface ListTasksParams {
  status?: DeliveryTaskStatus;
  warehouseId?: string;
  riderId?: string;
  orderNo?: string;
  limit?: number;
}

export interface TaskListResult {
  items: AdminDeliveryTask[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 构建列表 query string（不含 cursor） */
function buildTasksQuerySp(params: ListTasksParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
  if (params.riderId) sp.set('riderId', params.riderId);
  if (params.orderNo) sp.set('orderNo', params.orderNo);
  if (params.limit) sp.set('limit', String(params.limit));
  return sp;
}

/** 任务监控列表（游标分页 + 加载更多） */
export function useDispatchTasks(params: ListTasksParams = {}) {
  return useInfiniteQuery({
    queryKey: ['dispatch-tasks', params],
    queryFn: async ({ pageParam }) => {
      const sp = buildTasksQuerySp(params);
      if (pageParam) sp.set('cursor', pageParam);
      const query = sp.toString();
      const res = await apiFetch<ApiSuccess<TaskListResult>>(
        `/admin/dispatch/tasks${query ? `?${query}` : ''}`,
      );
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** 任务详情（含 order + rider） */
export function useDispatchTaskDetail(id: string | undefined) {
  return useQuery<AdminDeliveryTask>({
    queryKey: ['dispatch-tasks', 'detail', id],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminDeliveryTask>>(`/admin/dispatch/tasks/${id}`).then(
        (res) => res.data,
      ),
    enabled: !!id,
  });
}

/** 可派骑手列表（改派 Dialog 用，APPROVED + isOnline 在线优先） */
export function useAvailableRiders() {
  return useQuery<AvailableRider[]>({
    queryKey: ['dispatch-riders-available'],
    queryFn: () =>
      apiFetch<ApiSuccess<AvailableRider[]>>(`/admin/dispatch/riders/available`).then(
        (res) => res.data,
      ),
  });
}

/** 改派骑手（SUPER_ADMIN；第一期 ASSIGNED only） */
export function useReassignTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      newRiderId,
      reason,
    }: {
      taskId: string;
      newRiderId: string;
      reason?: string;
    }) =>
      apiFetch<ApiSuccess<AdminDeliveryTask>>(
        `/admin/dispatch/tasks/${taskId}/reassign`,
        {
          method: 'POST',
          body: JSON.stringify({ newRiderId, reason }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-tasks'] });
    },
  });
}

/** 取消任务（SUPER_ADMIN；PENDING_ASSIGN/ASSIGNED） */
export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason?: string }) =>
      apiFetch<ApiSuccess<AdminDeliveryTask>>(
        `/admin/dispatch/tasks/${taskId}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({ reason }),
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-tasks'] });
    },
  });
}

/** 补建任务（SUPER_ADMIN；幂等，已有则返回现有） */
export function useRecreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      apiFetch<ApiSuccess<AdminDeliveryTask>>(
        `/admin/dispatch/orders/${orderId}/recreate`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dispatch-tasks'] });
    },
  });
}
