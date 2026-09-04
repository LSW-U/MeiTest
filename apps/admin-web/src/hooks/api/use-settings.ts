/**
 * 设置页 hooks - /settings 用
 *
 * 后端三组接口：
 *   1. Shop：GET/PATCH /admin/shop
 *   2. Pricing：GET /admin/pricing/config + PATCH /admin/pricing/warehouses/:warehouseId/config（批次3 灰度配置，三字段 partial）
 *      旧 PATCH .../base-fee 保留向后兼容（@deprecated 转调），新代码用 /config
 *   3. SystemConfig：GET /admin/platform/system-configs + PUT /admin/platform/system-configs/:key
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

// ===== Shop =====

export interface Shop {
  id: string;
  name: Record<string, string>;
  logoUrl: string | null;
  phone: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE';
  businessHours: string | null;
  announcement?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateShopInput {
  name?: Record<string, string>;
  logoUrl?: string | null;
  phone?: string;
  address?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  businessHours?: string | null;
  announcement?: Record<string, string>;
}

export function useShop() {
  return useQuery({
    queryKey: ['settings', 'shop'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<Shop>>(`/admin/shop`);
      return res.data;
    },
  });
}

export function useUpdateShop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateShopInput) =>
      apiFetch<ApiSuccess<Shop>>(`/admin/shop`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'shop'] });
    },
  });
}

// ===== Pricing =====

export interface WarehousePricing {
  warehouseId: string;
  code: string;
  name: Record<string, string>;
  baseFee: number;
  perKmFee: number;
  /** 起步免费距离 km（批次3 灰度配置 2026-08-28）—— max(0, distanceKm - freeKm) 才计距离费 */
  freeKm: number;
  minOrderAmount: number;
  status: string;
}

export function usePricingConfig() {
  return useQuery({
    queryKey: ['settings', 'pricing'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<WarehousePricing[]>>(`/admin/pricing/config`);
      return res.data;
    },
  });
}

export function useUpdateWarehouseBaseFee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, baseFee }: { warehouseId: string; baseFee: number }) =>
      apiFetch<ApiSuccess<WarehousePricing>>(
        `/admin/pricing/warehouses/${warehouseId}/base-fee`,
        {
          method: 'PATCH',
          body: JSON.stringify({ baseFee }),
        },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'pricing'] });
    },
  });
}

/**
 * 更新仓库配送费配置（批次3 灰度配置 2026-08-28）
 *
 * PATCH /admin/pricing/warehouses/:warehouseId/config —— 三字段 partial：
 * baseFee/perKmFee（分，整数 ≥0）/ freeKm（km，≥0）。至少传一个字段（后端 zod refine 拦截空对象 → 400）。
 * 灰度切换路径：admin 在弹窗配 perKmFee=50 → 后端写 warehouse.perKmFee → 距离费生效。
 */
export interface UpdateWarehousePricingConfigInput {
  warehouseId: string;
  baseFee?: number;
  perKmFee?: number;
  freeKm?: number;
}

export function useUpdateWarehousePricingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ warehouseId, ...body }: UpdateWarehousePricingConfigInput) =>
      apiFetch<ApiSuccess<WarehousePricing>>(
        `/admin/pricing/warehouses/${warehouseId}/config`,
        {
          method: 'PATCH',
          body: JSON.stringify(body),
        },
      ).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'pricing'] });
    },
  });
}

// ===== SystemConfig =====

export interface SystemConfigItem {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export function useSystemConfigs() {
  return useQuery({
    queryKey: ['settings', 'system-configs'],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<SystemConfigItem[]>>(`/admin/platform/system-configs`);
      return res.data;
    },
  });
}

export function useUpdateSystemConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value, description }: { key: string; value: string; description?: string }) =>
      apiFetch<ApiSuccess<SystemConfigItem>>(`/admin/platform/system-configs/${key}`, {
        method: 'PUT',
        body: JSON.stringify({ value, description }),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'system-configs'] });
    },
  });
}
