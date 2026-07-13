/**
 * use-orders — 订单列表 + 详情 hooks（admin 视角）
 *
 * ⚠️ W3 状态：后端 admin orders endpoint 未实现（W3-C manifest §6 推到 W3+/W4）
 * 当前 admin 视角调 /client/orders 会被 DeviceTypeGuard 拒。
 * W4 后端补 /admin/orders/{list,detail} 后，本 hook 直接可用。
 *
 * 后端（W4 待实现）：
 *   - GET    /admin/orders              列表（含 status 过滤 + 游标分页）
 *   - GET    /admin/orders/:id          详情（含 items + events）
 *   - POST   /admin/orders/:id/cancel   admin 取消
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_CONFIRM'
  | 'CONFIRMED'
  | 'PICKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED_PAID'
  | 'DELIVERED'
  | 'DELIVERED_UNPAID'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'BANK_TRANSFER' | 'WECHAT' | 'PAYPAL' | 'STRIPE';
export type PaymentStatus = 'UNPAID' | 'PAID' | 'REFUNDED';

export interface OrderItem {
  id: string;
  productId: string;
  skuId: string;
  productName: I18nText;
  skuName: I18nText;
  productImage?: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface OrderListItem {
  id: string;
  orderNo: string;
  userId: string;
  warehouseId: string;
  status: OrderStatus;
  totalAmount: number;
  deliveryFee: number;
  payableAmount: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  itemCount?: number;
  createdAt: string;
  paidAt: string | null;
}

export interface OrderDetail extends OrderListItem {
  items: OrderItem[];
  remark: string | null;
  riderId: string | null;
  discountAmount: number;
  confirmedAt: string | null;
  pickedAt: string | null;
  deliveringAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  /** 应用的促销（W7-ext-G-fix2）：null = 未用码 */
  promotion: {
    promotionId: string;
    code: string;
    discountAmount: number;
  } | null;
}

export interface ListOrdersParams {
  status?: OrderStatus;
  userId?: string;
  warehouseId?: string;
  orderNo?: string;
  limit?: number;
  cursor?: string;
}

export interface OrderListResult {
  items: OrderListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 列表（W4 后端已实现） */
export function useOrders(params: ListOrdersParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.userId) searchParams.set('userId', params.userId);
  if (params.warehouseId) searchParams.set('warehouseId', params.warehouseId);
  if (params.orderNo) searchParams.set('orderNo', params.orderNo);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.cursor) searchParams.set('cursor', params.cursor);
  const query = searchParams.toString();
  return useQuery<OrderListResult>({
    queryKey: ['orders', params],
    queryFn: () =>
      apiFetch<ApiSuccess<OrderListResult>>(
        `/admin/orders${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 详情 */
export function useOrderDetail(id: string | undefined) {
  return useQuery<OrderDetail>({
    queryKey: ['orders', id],
    queryFn: () =>
      apiFetch<ApiSuccess<OrderDetail>>(`/admin/orders/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

/** admin 取消订单 */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      apiFetch<ApiSuccess<{ id: string; status: OrderStatus }>>(
        `/admin/orders/${id}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: reason ?? 'admin cancelled' }) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** admin 确认订单（COD：PENDING_CONFIRM -> CONFIRMED） */
export function useConfirmOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; status: OrderStatus }>>(
        `/admin/orders/${id}/confirm`,
        { method: 'POST', body: JSON.stringify({}) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** admin 拣货完成（CONFIRMED -> PICKED） */
export function usePickOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<{ id: string; status: OrderStatus }>>(
        `/admin/orders/${id}/pick`,
        { method: 'POST', body: JSON.stringify({}) },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

/** admin 编辑订单（仅 remark） */
export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, remark }: { id: string; remark: string | null }) =>
      apiFetch<ApiSuccess<OrderDetail>>(`/admin/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ remark }),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}
