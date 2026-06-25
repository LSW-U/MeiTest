/**
 * use-warehouses — 仓库 CRUD hooks
 *
 * 后端：apps/api/src/modules/warehouse/warehouse.controller.ts
 *   - GET    /admin/warehouses             列表
 *   - GET    /admin/warehouses/:id         详情
 *   - POST   /admin/warehouses             新建
 *   - PATCH  /admin/warehouses/:id         更新（含启停）
 *   - PATCH  /admin/warehouses/:id/coverage 配送范围（GeoJSON Polygon）
 *   - DELETE /admin/warehouses/:id         删除
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface Warehouse {
  id: string;
  code: string;
  name: I18nText;
  address: string;
  centerLat: number;
  centerLng: number;
  coverageArea?: GeoJsonPolygon | null;
  deliveryFee: number;
  perKmFee?: number;
  minOrderAmount?: number;
  isActive: boolean;
  operatingHours?: Record<string, { open: string; close: string } | null>;
}

export interface UpsertWarehouseInput {
  code?: string;
  name: I18nText;
  address: string;
  centerLat: number;
  centerLng: number;
  deliveryFee: number;
  perKmFee?: number;
  minOrderAmount?: number;
  isActive?: boolean;
  operatingHours?: Record<string, { open: string; close: string } | null>;
}

export interface UpdateCoverageInput {
  coverageArea: GeoJsonPolygon;
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: () => apiFetch<ApiSuccess<Warehouse[]>>('/admin/warehouses'),
  });
}

export function useWarehouse(id: string | undefined) {
  return useQuery({
    queryKey: ['warehouse', id],
    queryFn: () => apiFetch<ApiSuccess<Warehouse>>(`/admin/warehouses/${id}`),
    enabled: !!id,
  });
}

export function useCreateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertWarehouseInput) =>
      apiFetch<ApiSuccess<Warehouse>>('/admin/warehouses', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}

export function useUpdateWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<UpsertWarehouseInput> }) =>
      apiFetch<ApiSuccess<Warehouse>>(`/admin/warehouses/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouse', res.data.id] });
    },
  });
}

export function useUpdateWarehouseCoverage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCoverageInput }) =>
      apiFetch<ApiSuccess<Warehouse>>(`/admin/warehouses/${id}/coverage`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['warehouse', res.data.id] });
    },
  });
}

export function useDeleteWarehouse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/warehouses/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['warehouses'] }),
  });
}
