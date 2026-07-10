/**
 * use-customers - 客户管理 hooks（admin 视角）
 *
 * 后端：apps/api/src/modules/user/admin-user.controller.ts
 *   - GET    /admin/users              列表（keyword/role/status 筛选 + 分页 + orderCount/totalSpent 聚合）
 *   - GET    /admin/users/:id          详情（含最近 5 订单 + 全部地址）
 *   - PATCH  /admin/users/:id          编辑资料
 *   - POST   /admin/users/:id/suspend  暂停（status -> SUSPENDED）
 *   - POST   /admin/users/:id/activate 激活（status -> ACTIVE，仅从 SUSPENDED）
 *   - POST   /admin/users/:id/reset-password 重置密码（返回 12 字符临时密码）
 *
 * 安全约束：
 *   - 不能暂停/降级自己（E-ADMIN-USER-005）
 *   - 不能暂停其他 super_admin（E-ADMIN-USER-004）
 *   - DELETED 是终态，不可激活/重置密码（E-ADMIN-USER-003）
 *   - 重置密码明文一次性返回，不落库
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type UserRole =
  | 'super_admin'
  | 'customer'
  | 'rider'
  | 'warehouse_staff'
  | 'customer_service';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface Address {
  id: string;
  userId: string;
  name: string;
  phone: string;
  region: { province: string; city: string; district?: string | null };
  detail: string;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  tag: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  status: string;
  payableAmount: number;
  createdAt: string;
}

export interface CustomerListItem {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  phoneVerified: boolean;
  emailVerified: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  orderCount: number;
  totalSpent: number;
}

export interface CustomerDetail extends CustomerListItem {
  updatedAt: string;
  recentOrders: OrderSummary[];
  addresses: Address[];
}

export interface ListCustomersParams {
  keyword?: string;
  role?: UserRole;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
}

export interface ListCustomersResult {
  items: CustomerListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface UpdateCustomerInput {
  name?: string;
  phone?: string;
  email?: string | null;
  avatarUrl?: string;
  role?: UserRole;
  phoneVerified?: boolean;
  emailVerified?: boolean;
}

export interface SuspendCustomerInput {
  id: string;
  reason?: string;
}

export interface ActivateCustomerInput {
  id: string;
  reason?: string;
}

export interface ResetPasswordResult {
  temporaryPassword: string;
  generatedAt: string;
}

/** 列表 */
export function useCustomers(params: ListCustomersParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.keyword) searchParams.set('keyword', params.keyword);
  if (params.role) searchParams.set('role', params.role);
  if (params.status) searchParams.set('status', params.status);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
  const query = searchParams.toString();
  return useQuery<ListCustomersResult>({
    queryKey: ['customers', params],
    queryFn: () =>
      apiFetch<ApiSuccess<ListCustomersResult>>(
        `/admin/users${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 详情 */
export function useCustomerDetail(id: string | undefined) {
  return useQuery<CustomerDetail>({
    queryKey: ['customers', id],
    queryFn: () =>
      apiFetch<ApiSuccess<CustomerDetail>>(`/admin/users/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

/** 编辑资料 */
export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCustomerInput }) =>
      apiFetch<ApiSuccess<CustomerDetail>>(`/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers', vars.id] });
    },
  });
}

/** 暂停 */
export function useSuspendCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: SuspendCustomerInput) =>
      apiFetch<ApiSuccess<CustomerDetail>>(`/admin/users/${id}/suspend`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }).then((res) => res.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers', vars.id] });
    },
  });
}

/** 激活 */
export function useActivateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: ActivateCustomerInput) =>
      apiFetch<ApiSuccess<CustomerDetail>>(`/admin/users/${id}/activate`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }).then((res) => res.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers', vars.id] });
    },
  });
}

/** 重置密码（返回 12 字符临时密码，明文一次性） */
export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<ResetPasswordResult>>(`/admin/users/${id}/reset-password`, {
        method: 'POST',
      }).then((res) => res.data),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['customers', id] });
    },
  });
}
