/**
 * use-refunds — 退款列表 + 审核 hooks
 *
 * 后端：apps/api/src/modules/refund/refund.controller.ts
 *   - GET    /admin/refunds                列表（可按 status 筛选）
 *   - GET    /admin/refunds/:id            详情
 *   - POST   /admin/refunds/:id/review     审核（APPROVE / REJECT）
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type RefundStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Refund {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  reason: string;
  reasonDetail: string | null;
  status: RefundStatus;
  transactionId: string | null;
  refundMethod: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewRefundInput {
  action: 'APPROVE' | 'REJECT';
  reviewNote?: string;
}

/** 列表（admin，可按 status 筛选） */
export function useRefunds(status?: RefundStatus) {
  const query = status ? `?status=${status}` : '';
  return useQuery<Refund[]>({
    queryKey: ['refunds', status],
    queryFn: () =>
      apiFetch<ApiSuccess<Refund[]>>(`/admin/refunds${query}`).then((res) => res.data),
  });
}

/** 详情 */
export function useRefundDetail(id: string | undefined) {
  return useQuery<Refund>({
    queryKey: ['refunds', id],
    queryFn: () =>
      apiFetch<ApiSuccess<Refund>>(`/admin/refunds/${id}`).then((res) => res.data),
    enabled: !!id,
  });
}

/** 审核（APPROVE / REJECT） */
export function useReviewRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ReviewRefundInput }) =>
      apiFetch<ApiSuccess<Refund>>(`/admin/refunds/${id}/review`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['refunds'] });
    },
  });
}
