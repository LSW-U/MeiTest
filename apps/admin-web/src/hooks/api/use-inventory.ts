/**
 * use-inventory — 库存查询/调整 hooks
 *
 * 后端：apps/api/src/modules/inventory/inventory.controller.ts
 *   - POST /admin/inventory/match-warehouse  按坐标匹配仓库
 *   - GET  /admin/inventory/stocks           库存列表（按 warehouseId/skuId 过滤）
 *   - GET  /admin/inventory/logs             库存变更日志
 *   - GET  /admin/inventory/:skuId           按 SKU 查多仓库存
 *   - PATCH /admin/inventory/stocks          批量调整库存
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  apiFetch,
  apiUploadFile,
  API_BASE_URL,
  getPerspective,
  getLocale,
  ApiError,
  type ApiSuccess,
} from '@/lib/api';

export interface Stock {
  id: string;
  warehouseId: string;
  skuId: string;
  quantity: number;
  safetyStock?: number;
}

export interface StockLog {
  id: string;
  warehouseId: string;
  skuId: string;
  change: number;
  beforeQuantity: number;
  afterQuantity: number;
  reason?: string;
  operatorId?: string;
  createdAt: string;
}

export interface AdjustStockInput {
  warehouseId: string;
  skuId: string;
  delta: number;
  reason?: string;
}

export interface StockFilter {
  warehouseId?: string;
  skuId?: string;
  page?: number;
  pageSize?: number;
}

export function useStocks(filter: StockFilter = {}) {
  const query = new URLSearchParams();
  if (filter.warehouseId) query.set('warehouseId', filter.warehouseId);
  if (filter.skuId) query.set('skuId', filter.skuId);
  if (filter.page) query.set('page', String(filter.page));
  if (filter.pageSize) query.set('pageSize', String(filter.pageSize));
  const qs = query.toString();
  return useQuery({
    queryKey: ['stocks', filter],
    queryFn: () =>
      apiFetch<ApiSuccess<Stock[] | { items: Stock[]; total: number }>>(
        `/admin/inventory/stocks${qs ? `?${qs}` : ''}`,
      ),
  });
}

export function useStockLogs(warehouseId: string | undefined) {
  return useQuery({
    queryKey: ['stock-logs', warehouseId],
    queryFn: () => {
      const qs = warehouseId ? `?warehouseId=${warehouseId}` : '';
      return apiFetch<ApiSuccess<StockLog[]>>(`/admin/inventory/logs${qs}`);
    },
    enabled: !!warehouseId,
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdjustStockInput) =>
      apiFetch<ApiSuccess<Stock>>('/admin/inventory/stocks', {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      qc.invalidateQueries({ queryKey: ['stock-logs'] });
    },
  });
}

// ============================================================================
// 批次 5：批量调整 + 调拨 + CSV 导入导出
// ============================================================================

export interface BatchAdjustItem {
  warehouseId: string;
  skuId: string;
  deltaQty: number;
  reason?: string;
}

export interface BatchAdjustResultItem {
  warehouseId: string;
  skuId: string;
  deltaQty: number;
  afterQty: number;
}

/** 批量调整（全事务，上限 100） */
export function useBatchAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: BatchAdjustItem[]) =>
      apiFetch<ApiSuccess<{ items: BatchAdjustResultItem[] }>>(
        '/admin/inventory/stocks/batch-adjust',
        { method: 'POST', body: JSON.stringify({ items }) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      qc.invalidateQueries({ queryKey: ['stock-logs'] });
    },
  });
}

export interface TransferItemInput {
  skuId: string;
  quantity: number;
}

export interface TransferResultItem {
  skuId: string;
  quantity: number;
  fromAfterQty: number;
  toAfterQty: number;
}

export interface TransferResult {
  referenceId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: TransferResultItem[];
}

/** 仓库间调拨（双仓原子） */
export function useTransferStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      fromWarehouseId: string;
      toWarehouseId: string;
      items: TransferItemInput[];
      reason?: string;
    }) =>
      apiFetch<ApiSuccess<TransferResult>>('/admin/inventory/transfer', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      qc.invalidateQueries({ queryKey: ['stock-logs'] });
      qc.invalidateQueries({ queryKey: ['transfers'] });
    },
  });
}

export interface TransferRecord {
  referenceId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  items: Array<{ skuId: string; quantity: number }>;
  reason: string | null;
  operatorId: string | null;
  createdAt: string;
}

/** 调拨记录列表（按 referenceId 聚合） */
export function useTransfers(
  filter: { fromWarehouseId?: string; toWarehouseId?: string; limit?: number } = {},
) {
  const query = new URLSearchParams();
  if (filter.fromWarehouseId) query.set('fromWarehouseId', filter.fromWarehouseId);
  if (filter.toWarehouseId) query.set('toWarehouseId', filter.toWarehouseId);
  if (filter.limit) query.set('limit', String(filter.limit));
  const qs = query.toString();
  return useQuery({
    queryKey: ['transfers', filter],
    queryFn: () =>
      apiFetch<ApiSuccess<TransferRecord[]>>(
        `/admin/inventory/transfers${qs ? `?${qs}` : ''}`,
      ).then((res) => res.data),
  });
}

export interface ImportResultData {
  successCount: number;
  failedRows: Array<{ row: number; error: string }>;
}

/** 导入批量调整 CSV（multipart file，逐行部分成功返 failedRows） */
export function useImportStocksCsv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      apiUploadFile<ApiSuccess<ImportResultData>>(
        '/admin/inventory/stocks/import',
        file,
        'file',
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stocks'] });
      qc.invalidateQueries({ queryKey: ['stock-logs'] });
    },
  });
}

/**
 * 导出库存快照 CSV（raw fetch + Blob 下载，参考 audit-logs exportAuditCsv）
 *
 * 不用 apiFetch（它 JSON.parse，CSV 非 JSON）；用 raw fetch 拿 Blob 触发下载
 */
export async function exportStocksCsv(warehouseId?: string): Promise<void> {
  const qs = warehouseId ? `?warehouseId=${warehouseId}` : '';
  const headers = new Headers();
  headers.set('Accept-Language', getLocale());
  const perspective = getPerspective();
  if (perspective) headers.set('X-Perspective', perspective);

  const res = await fetch(`${API_BASE_URL}/admin/inventory/stocks/export${qs}`, {
    headers,
    credentials: 'include', // 带 httpOnly cookie
  });
  if (!res.ok) {
    throw new ApiError(`E-HTTP-${res.status}`, res.statusText, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stocks-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
