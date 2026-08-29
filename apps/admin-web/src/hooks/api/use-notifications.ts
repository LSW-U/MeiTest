/**
 * use-notifications — 后台通知推送 hooks（admin-web 优化方案 批次3 2026-08-29）
 *
 * 后端：apps/api AdminNotificationController（@Controller('api/v1/admin/notifications')，SUPER_ADMIN）
 *   - POST /admin/notifications          发送（target/type/多语言 title+content/data）
 *   - GET  /admin/notifications          发送历史（type/page/pageSize，单行近似，无 target）
 *
 * 契约：packages/api-contract/src/schemas/user.ts
 *   AdminSendNotificationRequest / AdminSendNotificationResponseData
 *   AdminNotificationHistoryItem / AdminNotificationHistoryListResponseData / AdminListNotificationsQuery
 *
 * 关键约束（批次2 审查 P2-1）：AdminNotificationHistoryItem 无 target 字段（MVP 不建 NotificationBatch 表），
 * deliveredCount 为单行近似值（恒为 1，非批次规模）。Header 铃铛复用 GET /admin/notifications 历史，
 * 非 /client/notifications（super_admin via admin_web 被 DeviceTypeGuard 拦截 E-AUTH-001）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 多语言文本（I18nText = Record<string,string>） */
export type I18nText = Record<string, string>;

/** 通知目标（NotificationTarget enum） */
export type NotificationTarget = 'ALL_CUSTOMERS' | 'ALL_RIDERS' | 'SPECIFIC_USERS';

/** 通知类型（AdminNotificationType enum） */
export type AdminNotificationType = 'ORDER_UPDATE' | 'PROMOTION' | 'SYSTEM';

/** 发送请求（AdminSendNotificationRequest，SPECIFIC_USERS 必带 userIds） */
export interface AdminSendNotificationRequest {
  target: NotificationTarget;
  userIds?: string[];
  type: AdminNotificationType;
  title: I18nText;
  content: I18nText;
  data?: Record<string, unknown> | null;
}

/** 发送响应（AdminSendNotificationResponseData） */
export interface AdminSendNotificationResponseData {
  deliveredCount: number;
  push: {
    success: boolean;
    mockFlag: boolean;
    error: string | null;
  };
}

/** 历史项（AdminNotificationHistoryItem，无 target，deliveredCount 单行近似） */
export interface AdminNotificationHistoryItem {
  id: string;
  type: AdminNotificationType;
  deliveredCount: number;
  title: I18nText;
  content: I18nText;
  createdAt: string;
}

/** 历史列表响应 */
export interface AdminNotificationHistoryListResponseData {
  items: AdminNotificationHistoryItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

/** 历史查询参数（AdminListNotificationsQuery，仅 type/page/pageSize） */
export interface AdminListNotificationsQuery {
  type?: AdminNotificationType;
  page?: number;
  pageSize?: number;
}

/** 构造 query string（跳过 undefined/空，前缀 ?） */
function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** 发送通知 */
export function useSendNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AdminSendNotificationRequest) =>
      apiFetch<ApiSuccess<AdminSendNotificationResponseData>>('/admin/notifications', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });
}

/** 发送历史列表（带 type 筛选 + 分页） */
export function useAdminNotificationHistory(query: AdminListNotificationsQuery) {
  return useQuery({
    queryKey: ['admin-notifications', 'history', query],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminNotificationHistoryListResponseData>>(
        '/admin/notifications' +
          qs({ type: query.type, page: query.page, pageSize: query.pageSize }),
      ).then((res) => res.data),
  });
}

/**
 * Header 铃铛：最近发送历史（首页 pageSize=5）。
 *
 * 复用 GET /admin/notifications（admin 发送历史），不调 /client/notifications
 * （super_admin via admin_web 被 DeviceTypeGuard 拦截）。
 * 历史项无 isRead/target → 铃铛展示「最近发送 + 计数」，不做未读/已读语义。
 */
export function useAdminRecentNotifications(pageSize = 5) {
  return useQuery({
    queryKey: ['admin-notifications', 'recent', pageSize],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminNotificationHistoryListResponseData>>(
        '/admin/notifications' + qs({ page: 1, pageSize }),
      ).then((res) => res.data),
  });
}
