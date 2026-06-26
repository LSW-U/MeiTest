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
import { apiFetch, type ApiSuccess } from '@/lib/api';

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
