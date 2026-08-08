/**
 * use-settlements - 结算单管理 hooks（admin 视角）
 *
 * 后端：apps/api/src/modules/settle/settlement.controller.ts
 *   - GET    /admin/settle/settlements              列表（offset 分页：page/pageSize）
 *   - GET    /admin/settle/settlements/:id          详情
 *   - POST   /admin/settle/settlements/:id/confirm  确认（PENDING → CONFIRMED）
 *   - POST   /admin/settle/settlements/run          手动触发（T+1 兜底/调试）
 *
 * 权限：全部 SUPER_ADMIN
 *
 * 字段与 contract SettlementSchema（packages/api-contract/src/schemas/settle.ts）对齐；
 * list 返回结构按 settlement.service.ts 实际返回（items + total + page + pageSize，无 hasMore，
 * 前端用 page*pageSize < total 判断是否还有下一页）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 结算单状态（contract SettlementStatus） */
export type SettlementStatus = 'PENDING' | 'CONFIRMED' | 'PAID' | 'DISPUTED';

/** 结算对象类型（contract SettlementSubjectType） */
export type SettlementSubjectType = 'MERCHANT' | 'RIDER';

/** 结算单（与 contract SettlementSchema 对齐） */
export interface Settlement {
  id: string;
  /** 结算周期 YYYY-MM-DD（按日聚合，T+1 触发） */
  periodDate: string;
  subjectType: SettlementSubjectType;
  subjectId: string;
  warehouseId: string | null;
  orderCount: number;
  /** 总交易额（分） */
  grossAmount: number;
  /** 平台抽成（分） */
  commission: number;
  /** 已退款金额（分） */
  refundAmount: number;
  /** 应结金额 = gross - commission - refund（分） */
  netAmount: number;
  status: SettlementStatus;
  confirmedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 列表返回（与 contract SettlementListResponse = OffsetPaginatedResponse 对齐；openapi 已注册端点）
 *  注：admin-web 不依赖 api-contract（只依赖 shared-types），类型手写与 contract SettlementSchema
 *  15 字段逐一对应。审查 P0-1 修复后契约对齐 offset（service 实际返 page/pageSize/total）。 */
export interface SettlementListResult {
  items: Settlement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListSettlementsParams {
  subjectType?: SettlementSubjectType;
  subjectId?: string;
  periodFrom?: string;
  periodTo?: string;
  status?: SettlementStatus;
  page?: number;
  pageSize?: number;
}

export interface RunSettlementInput {
  /** 结算周期 YYYY-MM-DD，缺省=昨天（T+1，后端默认） */
  periodDate?: string;
  subjectType: SettlementSubjectType;
  subjectId: string;
}

/** 列表（offset 分页） */
export function useSettlements(params: ListSettlementsParams = {}) {
  const sp = new URLSearchParams();
  if (params.subjectType) sp.set('subjectType', params.subjectType);
  if (params.subjectId) sp.set('subjectId', params.subjectId);
  if (params.periodFrom) sp.set('periodFrom', params.periodFrom);
  if (params.periodTo) sp.set('periodTo', params.periodTo);
  if (params.status) sp.set('status', params.status);
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  const query = sp.toString();
  return useQuery<SettlementListResult>({
    queryKey: ['settlements', params],
    queryFn: () =>
      apiFetch<ApiSuccess<SettlementListResult>>(
        `/admin/settle/settlements${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 详情 */
export function useSettlementDetail(id: string | undefined) {
  return useQuery<Settlement>({
    queryKey: ['settlements', id],
    queryFn: () =>
      apiFetch<ApiSuccess<Settlement>>(`/admin/settle/settlements/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

/** 确认结算单（PENDING → CONFIRMED） */
export function useConfirmSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch<ApiSuccess<Settlement>>(`/admin/settle/settlements/${id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({}),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}

/** 手动触发结算（T+1 兜底/调试；幂等：同 periodDate+subject 唯一） */
export function useRunSettlement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RunSettlementInput) =>
      apiFetch<ApiSuccess<Settlement>>('/admin/settle/settlements/run', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settlements'] });
    },
  });
}
