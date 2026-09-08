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

// ============================================================================
// 对账台账（批C 对账分流，微信支付预留 2026-09-08，方案V2 §3.3）
// 后端：apps/api/src/modules/reconciliation/reconciliation.controller.ts
// ============================================================================

/** 台账状态机 */
export type LedgerStatus = 'PENDING' | 'MATCHED' | 'DIFF' | 'SETTLED';

/** COD 收款结果 */
export type LedgerCashResult = 'PAID' | 'SHORT' | 'UNPAID';

/** 对账单格式 */
export type StatementFormat = 'WECHAT' | 'ALIPAY' | 'BANK';

/** 台账行（契约 ReconciliationLedgerView；method 含未来线上渠道全 8 值） */
export interface ReconciliationLedgerItem {
  id: string;
  orderId: string;
  orderNo: string;
  method: string;
  amountUsd: number;
  exchangeRate: number | null;
  amountCny: number | null;
  cashResult: LedgerCashResult | null;
  status: LedgerStatus;
  statementBatchId: string | null;
  createdAt: string;
}

/** 台账分区汇总行（契约 ReconciliationLedgerSummaryItem，group by method + cashResult） */
export interface ReconciliationLedgerSummaryItem {
  method: string;
  cashResult: LedgerCashResult | null;
  count: number;
  totalAmountUsd: number;
  totalAmountCny: number;
}

/** 对账单导入批次行（预留入口） */
export interface StatementImportBatchItem {
  id: string;
  fileName: string;
  format: StatementFormat;
  rowCount: number;
  successCount: number;
  failedCount: number;
  status: string;
  operatorId: string | null;
  createdAt: string;
}

export interface LedgerListResult {
  items: ReconciliationLedgerItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface BatchListResult {
  items: StatementImportBatchItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ListLedgersParams {
  method?: string;
  status?: LedgerStatus;
  orderNo?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}

/** 台账列表（offset 分页 + method/status/orderNo/日期筛选） */
export function useReconciliationLedger(params: ListLedgersParams = {}) {
  return useQuery<LedgerListResult>({
    queryKey: ['reconciliation-ledger', params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.method) sp.set('method', params.method);
      if (params.status) sp.set('status', params.status);
      if (params.orderNo) sp.set('orderNo', params.orderNo);
      if (params.dateFrom) sp.set('dateFrom', params.dateFrom);
      if (params.dateTo) sp.set('dateTo', params.dateTo);
      if (params.page) sp.set('page', String(params.page));
      if (params.pageSize) sp.set('pageSize', String(params.pageSize));
      const query = sp.toString();
      return apiFetch<ApiSuccess<LedgerListResult>>(
        `/admin/reconciliation/ledgers${query ? `?${query}` : ''}`,
      ).then((res) => res.data);
    },
  });
}

/** 台账分区汇总（COD 现金 / 银行转账 / 线上预留三区数据源） */
export function useLedgerSummary() {
  return useQuery<ReconciliationLedgerSummaryItem[]>({
    queryKey: ['reconciliation-ledger', 'summary'],
    queryFn: () =>
      apiFetch<ApiSuccess<{ items: ReconciliationLedgerSummaryItem[] }>>(
        '/admin/reconciliation/summary',
      ).then((res) => res.data.items),
  });
}

/** 对账单导入批次列表（预留入口） */
export function useImportBatches(params: { format?: StatementFormat; page?: number; pageSize?: number } = {}) {
  return useQuery<BatchListResult>({
    queryKey: ['reconciliation-ledger', 'import-batches', params],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.format) sp.set('format', params.format);
      if (params.page) sp.set('page', String(params.page));
      if (params.pageSize) sp.set('pageSize', String(params.pageSize));
      const query = sp.toString();
      return apiFetch<ApiSuccess<BatchListResult>>(
        `/admin/reconciliation/import-batches${query ? `?${query}` : ''}`,
      ).then((res) => res.data);
    },
  });
}
