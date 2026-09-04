/**
 * use-warehouses — 仓库 CRUD hooks
 *
 * 后端：apps/api/src/modules/warehouse/warehouse.controller.ts
 *   - GET    /admin/warehouses             列表（含 stockSummary，批 B）
 *   - GET    /admin/warehouses/:id         详情（含 staffList，批 B）
 *   - POST   /admin/warehouses             新建
 *   - PATCH  /admin/warehouses/:id         更新（UpdateWarehouseRequest 全可选 partial，批 B P2-1）
 *   - PATCH  /admin/warehouses/:id/coverage 配送范围（GeoJSON Polygon）
 *   - DELETE /admin/warehouses/:id         删除
 *
 * P3-3 归一化：后端 DTO 实际返回 status: 'ACTIVE'|'INACTIVE'（契约/前端按 isActive: boolean），
 * 本层统一 normalizeWarehouse() 派生 isActive，页面只消费 isActive。
 * 后端/契约对齐后此归一化可原样保留（isActive 直传）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';
import type { I18nText } from './use-products';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

/** 营业时间（批 B 契约 OperatingHours）：open/close 'HH:mm' 或 ''；rest:true 或空 = 休息日；不支持跨天 */
export type OperatingDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface OperatingHour {
  open: string;
  close: string;
  rest?: boolean;
}

export type OperatingHours = Record<OperatingDay, OperatingHour>;

export const OPERATING_DAYS: OperatingDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** 仓库列表库存聚合（批 B）：totalQuantity 含 0，sellableQuantity 仅 quantity>0 */
export interface StockSummary {
  skuCount: number;
  totalQuantity: number;
  sellableQuantity: number;
}

/** 仓库详情在编人员（批 B）：前端展示取 roles[0]，空数组显示 — */
export interface WarehouseStaffItem {
  id: string;
  userId: string;
  name: string | null;
  roles: string[];
}

/** 后端原始 status（P3-3 漂移，见文件头归一化说明） */
type WarehouseStatus = 'ACTIVE' | 'INACTIVE';

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
  freeKm?: number;
  minOrderAmount?: number;
  /** 详情页返回（GET /:id）；列表无 */
  staffList?: WarehouseStaffItem[];
  /** 列表返回（GET /）；详情无 */
  stockSummary?: StockSummary;
  operatingHours?: OperatingHours | null;
  /** 归一化后的启用态（页面只消费此字段） */
  isActive: boolean;
  /** 后端原始字段，仅归一化用 */
  status?: WarehouseStatus;
}

export interface UpsertWarehouseInput {
  code?: string;
  name: I18nText;
  address: string;
  centerLat: number;
  centerLng: number;
  deliveryFee: number;
  perKmFee?: number;
  freeKm?: number;
  minOrderAmount?: number;
  isActive?: boolean;
  /**
   * 契约 UpsertWarehouseRequest 中 coverageArea/operatingHours 为必填键（nullable 但键必须出现）：
   * 创建请求必须显式传这两个键（null 合法），否则 400 E-WAREHOUSE-004（批 C1 审查 P1-1）
   */
  coverageArea?: GeoJsonPolygon | null;
  operatingHours?: OperatingHours | null;
}

/** PATCH /:id 部分更新（批 B P2-1 选 a：UpdateWarehouseRequest 全可选，只动传入字段） */
export type UpdateWarehouseInput = Partial<UpsertWarehouseInput>;

export interface UpdateCoverageInput {
  coverageArea: GeoJsonPolygon;
}

/** P3-3：status → isActive 派生（isActive 直传时原样保留） */
function normalizeWarehouse<T extends Warehouse>(w: T): T {
  return { ...w, isActive: w.isActive ?? w.status === 'ACTIVE' };
}

function normalizeList<T extends Warehouse>(res: ApiSuccess<T[]>): ApiSuccess<T[]> {
  return { ...res, data: res.data.map(normalizeWarehouse) };
}

export function useWarehouses() {
  return useQuery({
    queryKey: ['warehouses'],
    queryFn: async () =>
      normalizeList(await apiFetch<ApiSuccess<Warehouse[]>>('/admin/warehouses')),
  });
}

export function useWarehouse(id: string | undefined) {
  return useQuery({
    queryKey: ['warehouse', id],
    queryFn: async () => {
      const res = await apiFetch<ApiSuccess<Warehouse>>(`/admin/warehouses/${id}`);
      return { ...res, data: normalizeWarehouse(res.data) };
    },
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
    mutationFn: ({ id, input }: { id: string; input: UpdateWarehouseInput }) =>
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
