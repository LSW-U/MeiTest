/**
 * 设置页 hooks - /settings 用
 *
 * 后端三组接口：
 *   1. Shop：GET/PATCH /admin/shop
 *   2. Pricing：GET /admin/pricing/config + PATCH /admin/pricing/warehouses/:id/base-fee
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
