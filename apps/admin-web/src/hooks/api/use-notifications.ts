/**
 * use-notifications — 后台通知推送 hooks（admin-web 优化方案 批次3 2026-08-29）
 *
 * 批A 批次化更新（2026-09-09）：后端已落 NotificationBatch 表，历史行语义从「按条」改「按批次」。
 *   - POST /admin/notifications                    发送 → 返回 batchId/totalRecipients/deliveredCount（首块同步落行数）
 *   - GET  /admin/notifications                    发送历史（type/page/pageSize，按批次行）
 *   - POST /admin/notifications/:batchId/retry     失败重试（仅重发 failed 用户，幂等：无 failed 时 retriedCount=0）
 *
 * 契约：packages/api-contract/src/schemas/notification.ts（批A 新文件）
 *   AdminSendNotificationRequest / AdminSendNotificationResponseData
 *   AdminNotificationHistoryItem（批次行：target + totalRecipients/deliveredCount/failedCount/readCount）
 *   AdminNotificationHistoryListResponseData / AdminListNotificationsQuery
 *   AdminRetryNotificationResponseData
 *
 * 口径（批A P3-1 裁决）：deliveredCount = 站内信落行数（非 PUSH 回执数）。
 * readCount 为实时聚合（用户点开站内信即 isRead）。
 * Header 铃铛复用 GET /admin/notifications 历史，非 /client/notifications
 * （super_admin via admin_web 被 DeviceTypeGuard 拦截 E-AUTH-001）。
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 多语言文本（I18nText = Record<string,string>） */
export type I18nText = Record<string, string>;

/** 通知目标（NotificationTarget enum） */
export type NotificationTarget = 'ALL_CUSTOMERS' | 'ALL_RIDERS' | 'SPECIFIC_USERS';

/** 通知类型（AdminNotificationType enum，批A 扩骑手任务/钱包） */
export type AdminNotificationType =
  | 'ORDER_UPDATE'
  | 'PROMOTION'
  | 'SYSTEM'
  | 'RIDER_TASK'
  | 'WALLET';

/** PUSH 结果（发送/重试响应共用） */
export interface AdminPushResult {
  success: boolean;
  mockFlag: boolean;
  error: string | null;
}

/** 发送请求（AdminSendNotificationRequest，SPECIFIC_USERS 必带 userIds） */
export interface AdminSendNotificationRequest {
  target: NotificationTarget;
  userIds?: string[];
  type: AdminNotificationType;
  title: I18nText;
  content: I18nText;
  data?: Record<string, unknown> | null;
}

/** 发送响应（AdminSendNotificationResponseData）：deliveredCount = 首块同步站内信落行数 */
export interface AdminSendNotificationResponseData {
  batchId: string;
  totalRecipients: number;
  deliveredCount: number;
  push: AdminPushResult;
}

/**
 * 历史项（AdminNotificationHistoryItem）：按批次一行。
 * deliveredCount=站内信落行数 / failedCount=未落行数（retry 目标）/ readCount=已读数（实时聚合）。
 */
export interface AdminNotificationHistoryItem {
  id: string;
  type: AdminNotificationType;
  target: NotificationTarget;
  totalRecipients: number;
  deliveredCount: number;
  failedCount: number;
  readCount: number;
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

/** 重试响应（AdminRetryNotificationResponseData） */
export interface AdminRetryNotificationResponseData {
  batchId: string;
  retriedCount: number;
  deliveredCount: number;
  failedCount: number;
  push: AdminPushResult;
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

/** 发送历史列表（批次行，带 type 筛选 + 分页） */
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
 * 批次失败重试：POST /admin/notifications/:batchId/retry。
 * 仅重发 failed 用户；无 failed 用户时后端幂等返回 retriedCount=0。
 */
export function useRetryNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) =>
      apiFetch<ApiSuccess<AdminRetryNotificationResponseData>>(
        `/admin/notifications/${batchId}/retry`,
        { method: 'POST' },
      ).then((res) => res.data),
    onSuccess: () => {
      // 重试后校正了批次 delivered/failed → 刷新历史行（含铃铛）
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });
}

/**
 * Header 铃铛：最近发送历史（首页 pageSize=5）。
 *
 * 复用 GET /admin/notifications（admin 发送历史，批次行），不调 /client/notifications
 * （super_admin via admin_web 被 DeviceTypeGuard 拦截）。
 * 铃铛语义为「最近发送历史」，不做未读/已读/全部已读（不新增 admin 未读端点）。
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
