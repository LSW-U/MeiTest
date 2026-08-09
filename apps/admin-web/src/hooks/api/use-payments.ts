/**
 * use-payments — 支付管理 hooks（admin 视角，批次 3）
 *
 * 后端：apps/api/src/modules/payment/admin-payment.controller.ts
 *   - GET    /admin/payments                          列表（游标分页 + join order）
 *   - GET    /admin/payments/reconciliation           对账汇总
 *   - GET    /admin/payments/:id                      详情（含 order + order.refunds）
 *   - POST   /admin/payments/:orderId/confirm-receipt 确认收款（PAID + Order CONFIRMED 同事务）
 *   - POST   /admin/payments/:orderId/mark-failed     标失败（手动）
 *
 * 权限：读 SUPER_ADMIN+CUSTOMER_SERVICE；写仅 SUPER_ADMIN
 */
import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PAID'
  | 'FAILED'
  | 'REFUNDED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'BANK_TRANSFER' | 'WECHAT' | 'PAYPAL' | 'STRIPE';

export interface PaymentIntentListItem {
  id: string;
  orderId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  transactionId: string | null;
  receiptUrl: string | null;
  mockFlag: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  orderNo: string;
  userId: string;
  warehouseId: string;
}

export interface PaymentRefundSummary {
  id: string;
  amount: number;
  status: string;
  reason: string;
}

export interface PaymentIntentDetail extends PaymentIntentListItem {
  order: {
    orderNo: string;
    userId: string;
    warehouseId: string;
    status: string;
    refunds: PaymentRefundSummary[];
  };
}

export interface ListPaymentsParams {
  status?: PaymentStatus;
  method?: PaymentMethod;
  orderId?: string;
  orderNo?: string;
  mockFlag?: boolean;
  limit?: number;
}

export interface PaymentListResult {
  items: PaymentIntentListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ReconciliationItem {
  status: string;
  method: string;
  count: number;
  totalAmount: number;
}

/** 构建列表 query string（不含 cursor） */
function buildPaymentsQuerySp(params: ListPaymentsParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.method) sp.set('method', params.method);
  if (params.orderId) sp.set('orderId', params.orderId);
  if (params.orderNo) sp.set('orderNo', params.orderNo);
  if (params.mockFlag !== undefined) sp.set('mockFlag', String(params.mockFlag));
  if (params.limit) sp.set('limit', String(params.limit));
  return sp;
}

/** 列表（游标分页 + 加载更多） */
export function usePayments(params: ListPaymentsParams = {}) {
  return useInfiniteQuery({
    queryKey: ['payments', params],
    queryFn: async ({ pageParam }) => {
      const sp = buildPaymentsQuerySp(params);
      if (pageParam) sp.set('cursor', pageParam);
      const query = sp.toString();
      const res = await apiFetch<ApiSuccess<PaymentListResult>>(
        `/admin/payments${query ? `?${query}` : ''}`,
      );
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** 详情（含 order + order.refunds） */
export function usePaymentDetail(id: string | undefined) {
  return useQuery<PaymentIntentDetail>({
    queryKey: ['payments', id],
    queryFn: () =>
      apiFetch<ApiSuccess<PaymentIntentDetail>>(`/admin/payments/${id}`).then(
        (res) => res.data,
      ),
    enabled: !!id,
  });
}

/** 对账汇总 */
export function useReconciliation() {
  return useQuery<ReconciliationItem[]>({
    queryKey: ['payments', 'reconciliation'],
    queryFn: () =>
      apiFetch<ApiSuccess<ReconciliationItem[]>>(
        '/admin/payments/reconciliation',
      ).then((res) => res.data),
  });
}

/** 确认收款（PAID + Order CONFIRMED 同事务） */
export function useConfirmReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) =>
      apiFetch<ApiSuccess<unknown>>(`/admin/payments/${orderId}/confirm-receipt`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

/** 标失败 */
export function useMarkFailed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) =>
      apiFetch<ApiSuccess<unknown>>(`/admin/payments/${orderId}/mark-failed`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
