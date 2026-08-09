/**
 * use-refunds — 退款列表 + 审核 hooks
 *
 * 后端：apps/api/src/modules/refund/refund.controller.ts
 *   - GET    /admin/refunds                列表（可按 status 筛选）
 *   - GET    /admin/refunds/:id            详情
 *   - POST   /admin/refunds/:id/review     审核（APPROVE / REJECT）
 */
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
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

/** 列表返回（游标分页：items + nextCursor + hasMore，批次 2.1 改造） */
export interface RefundListResult {
  items: Refund[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListRefundsParams {
  status?: RefundStatus;
  limit?: number;
}

/** 构建退款列表 query string（不含 cursor，首屏 + 加载更多复用） */
function buildRefundQuerySp(params: ListRefundsParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.limit) sp.set('limit', String(params.limit));
  return sp;
}

/**
 * 列表（admin，游标分页 + 加载更多）
 *
 * 后端 GET /admin/refunds 已支持 cursor query（refund.service.ts listAllRefunds），
 * 前端用 useInfiniteQuery + fetchNextPage + data.pages.flatMap 累积 items，
 * 不再返回扁平 Refund[]（批次 2.1 改造，与 admin orders 一致）。
 */
export function useRefunds(params: ListRefundsParams = {}) {
  return useInfiniteQuery({
    queryKey: ['refunds', params],
    queryFn: async ({ pageParam }) => {
      const sp = buildRefundQuerySp(params);
      if (pageParam) sp.set('cursor', pageParam);
      const query = sp.toString();
      const res = await apiFetch<ApiSuccess<RefundListResult>>(
        `/admin/refunds${query ? `?${query}` : ''}`,
      );
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
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
