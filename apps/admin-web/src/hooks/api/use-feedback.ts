/**
 * use-feedback — 后台反馈管理 hooks（admin-web 优化方案 批次3 2026-08-29）
 *
 * 后端：apps/api AdminFeedbackController（@Controller('api/v1/admin/feedback')，SUPER_ADMIN）
 *   - GET /admin/feedback          列表（category/keyword/startDate/endDate/page/pageSize）
 *   - GET /admin/feedback/:id      详情（含 submitter 扩展 email/role/status + images）
 *
 * 契约：packages/api-contract/src/schemas/feedback.ts
 *   AdminFeedbackListItem / AdminFeedbackDetail / AdminListFeedbackQuery / AdminFeedbackListResponseData
 *
 * 复用 reviews 页同款 qs() helper（URLSearchParams 跳过 undefined，前缀 ?）。
 * MVP 只读，无 mutation。
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 反馈分类（契约 FeedbackCategory enum） */
export type FeedbackCategory = 'feature' | 'product' | 'order' | 'payment' | 'shipping' | 'other';

/** 列表项（AdminFeedbackListItem，submitter 摘要：id/phone/name/avatarUrl） */
export interface AdminFeedbackListItem {
  id: string;
  userId: string;
  category: FeedbackCategory;
  content: string;
  contact: string | null;
  images: string[];
  createdAt: string;
  submitter: {
    id: string;
    phone: string | null;
    name: string | null;
    avatarUrl: string | null;
  } | null;
}

/** 详情项（AdminFeedbackDetail，submitter 扩展：email/role/status） */
export interface AdminFeedbackDetail {
  id: string;
  userId: string;
  category: FeedbackCategory;
  content: string;
  contact: string | null;
  images: string[];
  createdAt: string;
  submitter: {
    id: string;
    phone: string | null;
    email: string | null;
    name: string | null;
    avatarUrl: string | null;
    role: string;
    status: string;
  } | null;
}

/** 列表查询参数（AdminListFeedbackQuery） */
export interface AdminListFeedbackQuery {
  category?: FeedbackCategory;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

/** 列表响应（AdminFeedbackListResponseData） */
export interface AdminFeedbackListResponseData {
  items: AdminFeedbackListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/** 构造 query string（跳过 undefined，前缀 ?） */
function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function useAdminFeedbackList(query: AdminListFeedbackQuery) {
  return useQuery({
    queryKey: ['admin-feedback-list', query],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminFeedbackListResponseData>>(
        '/admin/feedback' +
          qs({
            category: query.category,
            keyword: query.keyword,
            startDate: query.startDate,
            endDate: query.endDate,
            page: query.page,
            pageSize: query.pageSize,
          }),
      ).then((res) => res.data),
  });
}

export function useAdminFeedbackDetail(id: string | null) {
  return useQuery({
    enabled: !!id,
    queryKey: ['admin-feedback-detail', id],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminFeedbackDetail>>(`/admin/feedback/${id}`).then((res) => res.data),
  });
}
