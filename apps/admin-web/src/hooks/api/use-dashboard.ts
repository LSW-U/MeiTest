/**
 * Dashboard 数据 hook - /statistics 页用
 *
 * 后端：GET /admin/platform/dashboard/summary?range=today|week|month
 *
 * 类型源：@meimart/shared-types（openapi-typescript 生成，单源）——
 * 批B 修复轮（2026-09-10）从本地接口切换，任务书改动 6 顺带项（dashboard 双 hook 统一）就此闭环
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { components } from '@meimart/shared-types';

type DashboardSummarySchema = components['schemas']['DashboardSummary'];

export type DashboardRange = DashboardSummarySchema['range'];
export type TrendPoint = DashboardSummarySchema['trend'][number];
export type WarehouseBreakdown = DashboardSummarySchema['warehouseBreakdown'][number];
export type DashboardSummary = DashboardSummarySchema;

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
