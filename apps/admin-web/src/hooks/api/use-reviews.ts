/**
 * use-reviews — 评论中心 hooks（admin-web）
 *
 * 后端：apps/api/src/modules/review/admin-review.controller.ts
 *   - GET    /admin/reviews            列表（type=customer|rider + 筛选）
 *   - GET    /admin/reviews/:id        详情（?type）
 *   - PATCH  /admin/reviews/:id        审核 status + 回复 reply（?type）
 *   - DELETE /admin/reviews/:id        硬删（?type）
 *
 * type=customer 走 reviews 表（客户评论），type=rider 走 rider_reviews 表（骑手评价）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ReviewCategory = 'PRODUCT' | 'DELIVERY';
export type ReviewType = 'customer' | 'rider';
export type RiderReviewTag = 'on_time' | 'polite' | 'professional' | 'careful';

/** 客户评论 */
export interface Review {
  id: string;
  orderId: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  rating: number;
  content: Record<string, string>;
  images: string[];
  status: ReviewStatus;
  category: ReviewCategory;
  reply: Record<string, string> | null;
  repliedAt: string | null;
  productId: string | null;
  createdAt: string;
}

/** 骑手评价 */
export interface RiderReview {
  id: string;
  orderId: string;
  riderId: string;
  userId: string;
  userName: string;
  rating: number;
  tags: RiderReviewTag[];
  comment: Record<string, string> | null;
  status: ReviewStatus;
  createdAt: string;
}

export interface ReviewListResult {
  items: Review[] | RiderReview[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
}

export interface ReviewListQuery {
  type: ReviewType;
  category?: ReviewCategory;
  status?: ReviewStatus;
  rating?: number;
  keyword?: string;
}

export interface UpdateReviewInput {
  status?: ReviewStatus;
  reply?: Record<string, string>;
}

function buildQuery(q: ReviewListQuery): string {
  const params = new URLSearchParams({ type: q.type });
  if (q.category) params.set('category', q.category);
  if (q.status) params.set('status', q.status);
  if (q.rating) params.set('rating', String(q.rating));
  if (q.keyword) params.set('keyword', q.keyword);
  return `?${params.toString()}`;
}

/** 列表（type + 多维筛选） */
export function useAdminReviews(query: ReviewListQuery) {
  return useQuery<ReviewListResult>({
    queryKey: ['reviews', query.type, query.category, query.status, query.rating, query.keyword],
    queryFn: () =>
      apiFetch<ApiSuccess<ReviewListResult>>(`/admin/reviews${buildQuery(query)}`).then(
        (res) => res.data,
      ),
  });
}

/** 详情（?type 区分两表） */
export function useReviewDetail(id: string | undefined, type: ReviewType) {
  return useQuery<Review | RiderReview>({
    queryKey: ['reviews', type, id],
    queryFn: () =>
      apiFetch<ApiSuccess<Review | RiderReview>>(`/admin/reviews/${id}?type=${type}`).then(
        (res) => res.data,
      ),
    enabled: !!id,
  });
}

/** 审核 status + 回复 reply */
export function useUpdateReview(type: ReviewType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateReviewInput }) =>
      apiFetch<ApiSuccess<Review | RiderReview>>(`/admin/reviews/${id}?type=${type}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

/** 硬删 */
export function useDeleteReview(type: ReviewType) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<ApiSuccess<{ id: string }>>(`/admin/reviews/${id}?type=${type}`, {
        method: 'DELETE',
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}
