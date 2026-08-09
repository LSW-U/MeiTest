/**
 * use-audit-logs - 审计日志查询 hooks（admin 视角）
 *
 * 后端：apps/api/src/modules/platform/audit.controller.ts
 *   - GET /admin/platform/audit-logs          列表（**游标分页** cursor + 加载更多）
 *   - GET /admin/platform/audit-logs/:id      详情（含 beforeData/afterData）
 *   - GET /admin/platform/audit-logs/export   导出 CSV（UTF-8 BOM，最多 10000 行）
 *
 * 权限：仅 SUPER_ADMIN
 *
 * 关键：audit 是真游标分页（service.list 用 cursor: {id} skip:1 + take:limit+1），
 * contract AuditLogListResponse = PaginatedResponse（cursor 风格 nextCursor/hasMore）
 * 与 service 实际返回一致（审查 1.3 verify 点 ② 通过，无 settlement 那种契约矛盾）。
 * 前端用 useInfiniteQuery + fetchNextPage + 累积 items，不用 offset 分页器。
 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  apiFetch,
  ApiError,
  getLocale,
  getPerspective,
  API_BASE_URL,
  type ApiSuccess,
} from '@/lib/api';

/** 设备类型 */
export type AuditDeviceType = 'CLIENT_APP' | 'RIDER_APP' | 'ADMIN_WEB';

/** 审计日志列表项（与 contract AuditLogListItem 9 字段对齐） */
export interface AuditLog {
  id: string;
  userId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  deviceType: AuditDeviceType | null;
  perspective: string | null;
  ip: string | null;
  createdAt: string;
}

/** 审计日志详情（ListItem + beforeData/afterData/userAgent/traceId） */
export interface AuditLogDetail extends AuditLog {
  beforeData: unknown;
  afterData: unknown;
  userAgent: string | null;
  traceId: string | null;
}

/** 列表返回（游标分页：items + nextCursor + hasMore） */
export interface AuditLogListResult {
  items: AuditLog[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListAuditLogsParams {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  perspective?: string;
  /** 安全审计：按 IP 筛选 */
  ip?: string;
  userAgent?: string;
  /** 链路追踪：traceId 精确查找 */
  traceId?: string;
  /** ISO 时间范围 */
  from?: string;
  to?: string;
  limit?: number;
}

/** 把筛选参数拼成 query string（不含 cursor，列表首屏 + 导出 CSV 复用） */
function buildAuditQuerySp(params: ListAuditLogsParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (params.userId) sp.set('userId', params.userId);
  if (params.resourceType) sp.set('resourceType', params.resourceType);
  if (params.resourceId) sp.set('resourceId', params.resourceId);
  if (params.action) sp.set('action', params.action);
  if (params.perspective) sp.set('perspective', params.perspective);
  if (params.ip) sp.set('ip', params.ip);
  if (params.userAgent) sp.set('userAgent', params.userAgent);
  if (params.traceId) sp.set('traceId', params.traceId);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.limit) sp.set('limit', String(params.limit));
  return sp;
}

/** 列表（游标分页 + 加载更多） */
export function useAuditLogs(params: ListAuditLogsParams = {}) {
  return useInfiniteQuery({
    queryKey: ['audit-logs', params],
    queryFn: async ({ pageParam }) => {
      const sp = buildAuditQuerySp(params);
      if (pageParam) sp.set('cursor', pageParam);
      const query = sp.toString();
      const res = await apiFetch<ApiSuccess<AuditLogListResult>>(
        `/admin/platform/audit-logs${query ? `?${query}` : ''}`,
      );
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

/** 详情（含 beforeData/afterData） */
export function useAuditLogDetail(id: string | undefined) {
  return useQuery<AuditLogDetail>({
    queryKey: ['audit-logs', id],
    queryFn: () =>
      apiFetch<ApiSuccess<AuditLogDetail>>(`/admin/platform/audit-logs/${id}`).then(
        (res) => res.data,
      ),
    enabled: !!id,
  });
}

/**
 * 导出 CSV（触发浏览器下载）
 *
 * 后端返 text/csv（含 UTF-8 BOM），不能用 apiFetch（它 JSON.parse 会报错）。
 * 用 raw fetch + credentials + Accept-Language/perspective header，Blob 触发下载。
 * GET 不需 CSRF（apiFetch 只 mutate 加 CSRF）。
 */
export async function exportAuditCsv(params: ListAuditLogsParams): Promise<void> {
  const sp = buildAuditQuerySp(params);
  const query = sp.toString();
  const headers: Record<string, string> = { 'Accept-Language': getLocale() };
  const perspective = getPerspective();
  if (perspective) headers['X-Perspective'] = perspective;

  const res = await fetch(
    `${API_BASE_URL}/admin/platform/audit-logs/export${query ? `?${query}` : ''}`,
    { credentials: 'include', headers },
  );
  if (!res.ok) {
    throw new ApiError(`E-HTTP-${res.status}`, res.statusText, res.status);
  }
  const csv = await res.text();
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
