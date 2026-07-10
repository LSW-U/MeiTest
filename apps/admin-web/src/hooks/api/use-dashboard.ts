/**
 * Dashboard 数据 hook - /statistics 页用
 *
 * 后端：GET /admin/platform/dashboard/summary?range=today|week|month
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type DashboardRange = 'today' | 'week' | 'month';

export interface TrendPoint {
  bucket: string;
  gmv: number;
  orderCount: number;
}

export interface WarehouseBreakdown {
  warehouseId: string;
  warehouseName: string;
  gmv: number;
  orderCount: number;
  abnormalCount: number;
}

export interface DashboardSummary {
  range: DashboardRange;
  from: string;
  to: string;
  gmv: number;
  gmvGrowthPct: number | null;
  orderCount: number;
  orderCountGrowthPct: number | null;
  onlineRiderCount: number;
  abnormalOrderCount: number;
  trend: TrendPoint[];
  warehouseBreakdown: WarehouseBreakdown[];
}

export function useDashboardSummary(range: DashboardRange) {
  return useQuery({
    queryKey: ['dashboard', 'summary', range],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<DashboardSummary>>(
        `/admin/platform/dashboard/summary?range=${range}`,
      );
      return res.data;
    },
  });
}
