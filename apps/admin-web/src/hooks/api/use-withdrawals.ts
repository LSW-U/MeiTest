/**
 * use-withdrawals - 提现申请管理 hooks（admin 视角）
 *
 * 后端：apps/api/src/modules/settle/withdraw.controller.ts
 *   - GET    /admin/settle/withdrawals              列表（offset 分页）
 *   - GET    /admin/settle/withdrawals/:id          详情
 *   - POST   /admin/settle/withdrawals              创建（super_admin 代录）
 *   - POST   /admin/settle/withdrawals/:id/review   审核（APPROVE/REJECT，REJECT 必填 rejectReason）
 *   - POST   /admin/settle/withdrawals/:id/mark-paid 标记线下打款完成（必填 payoutReference）
 *
 * 权限：写操作仅 SUPER_ADMIN；list/detail 开放 WAREHOUSE_STAFF/CUSTOMER_SERVICE 只读
 * （admin-web 当前不做 role 隐藏，后端 RBAC 兜底；与 settlements/customers 等现有页一致）
 *
 * 字段与 contract WithdrawalRequestSchema（settle.ts）对齐；list 返回 offset（page/pageSize/total），
 * 与 SettlementListResponse 一样走 OffsetPaginatedResponse（审查 P0-1 修复后契约对齐）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 提现状态（contract WithdrawalStatus） */
export type WithdrawalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID' | 'FAILED';

/** 申请方类型（contract WithdrawalRequesterType） */
export type WithdrawalRequesterType = 'MERCHANT' | 'RIDER';

/** 收款账户渠道 */
export type PayoutChannel = 'BANK_TRANSFER' | 'WECHAT' | 'ALIPAY' | 'PAYPAL';

/** 收款账户（contract PayoutAccount） */
export interface PayoutAccount {
  channel: PayoutChannel;
  account: string;
  holderName?: string;
  /** BANK_TRANSFER 专用 */
  bankName?: string;
  branchName?: string;
}

/** 提现申请（与 contract WithdrawalRequestSchema 对齐） */
export interface Withdrawal {
  id: string;
  requesterType: WithdrawalRequesterType;
  requesterId: string;
  /** 申请金额（分） */
  amount: number;
  status: WithdrawalStatus;
  payoutAccount: PayoutAccount;
  rejectReason: string | null;
  payoutReference: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 列表返回（与 contract WithdrawalListResponse = OffsetPaginatedResponse 对齐） */
export interface WithdrawalListResult {
  items: Withdrawal[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ListWithdrawalsParams {
  requesterType?: WithdrawalRequesterType;
  requesterId?: string;
  status?: WithdrawalStatus;
  page?: number;
  pageSize?: number;
}

export interface ReviewWithdrawalInput {
  action: 'APPROVE' | 'REJECT';
  rejectReason?: string;
}

export interface MarkPaidWithdrawalInput {
  /** 银行流水号/交易号 */
  payoutReference: string;
}

export interface CreateWithdrawalInput {
  requesterType: WithdrawalRequesterType;
  requesterId: string;
  /** 申请金额（分） */
  amount: number;
  payoutAccount: PayoutAccount;
}

/** 列表（offset 分页） */
export function useWithdrawals(params: ListWithdrawalsParams = {}) {
  const sp = new URLSearchParams();
  if (params.requesterType) sp.set('requesterType', params.requesterType);
  if (params.requesterId) sp.set('requesterId', params.requesterId);
  if (params.status) sp.set('status', params.status);
  if (params.page) sp.set('page', String(params.page));
  if (params.pageSize) sp.set('pageSize', String(params.pageSize));
  const query = sp.toString();
  return useQuery<WithdrawalListResult>({
    queryKey: ['withdrawals', params],
    queryFn: () =>
      apiFetch<ApiSuccess<WithdrawalListResult>>(
        `/admin/settle/withdrawals${query ? `?${query}` : ''}`,
      ).then((res) => res.data),
  });
}

/** 详情 */
export function useWithdrawalDetail(id: string | undefined) {
  return useQuery<Withdrawal>({
    queryKey: ['withdrawals', id],
    queryFn: () =>
      apiFetch<ApiSuccess<Withdrawal>>(`/admin/settle/withdrawals/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

/** 审核（APPROVE/REJECT，REJECT 必填 rejectReason） */
export function useReviewWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReviewWithdrawalInput }) =>
      apiFetch<ApiSuccess<Withdrawal>>(`/admin/settle/withdrawals/${id}/review`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

/** 标记线下打款完成（APPROVED → PAID） */
export function useMarkPaidWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkPaidWithdrawalInput }) =>
      apiFetch<ApiSuccess<Withdrawal>>(`/admin/settle/withdrawals/${id}/mark-paid`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}

/** 创建提现申请（super_admin 代录） */
export function useCreateWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWithdrawalInput) =>
      apiFetch<ApiSuccess<Withdrawal>>('/admin/settle/withdrawals', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['withdrawals'] });
    },
  });
}
