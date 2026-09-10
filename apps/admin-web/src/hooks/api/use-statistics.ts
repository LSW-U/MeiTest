/**
 * Statistics 数据 hooks - 数据分析报表模块（批B 2026-09-10 / 批C 2026-09-10）
 *
 * 后端：GET /admin/statistics/products/top?range=|from=&to=&limit=&lang=
 *       GET /admin/statistics/riders?range=|from=&to=
 *
 * 类型源：@meimart/shared-types（openapi-typescript 生成，Q1 单源——任务书改动 6 顺带项：
 * dashboard 双 hook 统一到 shared-types 已落在本仓 use-dashboard.ts，批B 修复轮 2026-09-10 完成）
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { components } from '@meimart/shared-types';

type StatisticsTopProductsData = components['schemas']['StatisticsTopProductsData'];
type StatisticsTopProductItem = components['schemas']['StatisticsTopProductItem'];

export type StatisticsRange = 'today' | 'week' | 'month';

export interface TopProductsParams {
  /** 预设范围（自定义时为 undefined） */
  range?: StatisticsRange;
  /** 自定义范围 YYYY-MM-DD 含头尾（预设时为 undefined） */
  custom?: { from: string; to: string };
  limit?: number;
}

function buildRangeQuery(params: TopProductsParams): string {
  const qs = new URLSearchParams();
  if (params.range) qs.set('range', params.range);
  if (params.custom) {
    qs.set('from', params.custom.from);
    qs.set('to', params.custom.to);
  }
  if (params.limit) qs.set('limit', String(params.limit));
  return qs.toString();
}

export function useTopProducts(params: TopProductsParams) {
  return useQuery({
    queryKey: ['statistics', 'top-products', params.range, params.custom?.from, params.custom?.to, params.limit],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<StatisticsTopProductsData>>(
        `/admin/statistics/products/top?${buildRangeQuery(params)}`,
      );
      return res.data;
    },
  });
}

// ===== 骑手绩效（批C，2026-09-10）=====

type StatisticsRidersData = components['schemas']['StatisticsRidersData'];
type StatisticsRidersResponseItem = components['schemas']['StatisticsRidersResponseItem'];

export interface RidersParams {
  /** 预设范围（自定义时为 undefined） */
  range?: StatisticsRange;
  /** 自定义范围 YYYY-MM-DD 含头尾（预设时为 undefined） */
  custom?: { from: string; to: string };
}

function buildRidersQuery(params: RidersParams): string {
  const qs = new URLSearchParams();
  if (params.range) qs.set('range', params.range);
  if (params.custom) {
    qs.set('from', params.custom.from);
    qs.set('to', params.custom.to);
  }
  return qs.toString();
}

export function useRiders(params: RidersParams) {
  return useQuery({
    queryKey: ['statistics', 'riders', params.range, params.custom?.from, params.custom?.to],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<StatisticsRidersData>>(
        `/admin/statistics/riders?${buildRidersQuery(params)}`,
      );
      return res.data;
    },
  });
}

// ===== 退款统计（批D，2026-09-10）=====

type StatisticsRefundsData = components['schemas']['StatisticsRefundsData'];
type StatisticsRefundReasonItem = components['schemas']['StatisticsRefundReasonItem'];

export interface RefundsParams {
  /** 预设范围（自定义时为 undefined） */
  range?: StatisticsRange;
  /** 自定义范围 YYYY-MM-DD 含头尾（预设时为 undefined） */
  custom?: { from: string; to: string };
}

function buildRefundsQuery(params: RefundsParams): string {
  const qs = new URLSearchParams();
  if (params.range) qs.set('range', params.range);
  if (params.custom) {
    qs.set('from', params.custom.from);
    qs.set('to', params.custom.to);
  }
  return qs.toString();
}

export function useRefunds(params: RefundsParams) {
  return useQuery({
    queryKey: ['statistics', 'refunds', params.range, params.custom?.from, params.custom?.to],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<StatisticsRefundsData>>(
        `/admin/statistics/refunds?${buildRefundsQuery(params)}`,
      );
      return res.data;
    },
  });
}

export type {
  StatisticsRidersResponseItem,
  StatisticsRidersData,
  StatisticsTopProductItem,
  StatisticsTopProductsData,
  StatisticsRefundReasonItem,
  StatisticsRefundsData,
};
