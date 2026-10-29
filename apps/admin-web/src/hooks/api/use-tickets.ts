/**
 * use-tickets — 后台工单管理 hooks（替换品批3 D22，2026-10-30）
 *
 * 后端：apps/api AdminTicketController（@Controller('api/v1/admin/tickets')，SUPER_ADMIN+CUSTOMER_SERVICE）
 *   - GET  /admin/tickets                 列表（status/escalated/cursor/limit，游标分页）
 *   - GET  /admin/tickets/:ticketNo       详情（AdminTicket，含 escalated/userId）
 *   - POST /admin/tickets/:ticketNo/status 状态流转（D18 四态线性，action=目标状态）
 *
 * 契约：packages/api-contract/src/schemas/ticket.ts
 *   AdminTicket / AdminTicketListResponse / AdminTicketStatusResponse
 *
 * 列表用 useInfiniteQuery（游标），同 use-refunds 模式。
 * P2-2：工单查询不依赖封号状态——后端 JWT guard 不查 user.status，前端无额外处理。
 */
import {
  useQuery,
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from '@tanstack/react-query';
import { apiFetch, type ApiSuccess } from '@/lib/api';

/** 工单状态（D18 四态） */
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

/** 工单类型（D15 六枚举） */
export type TicketType =
  | 'CUSTOMER_UNREACHABLE'
  | 'CUSTOMER_REJECTED'
  | 'ADDRESS_NOT_FOUND'
  | 'TRAFFIC_ACCIDENT'
  | 'OTHER'
  | 'FEEDBACK';

/** 时间线事件（TicketEvent，契约批2 同构） */
export interface TicketEvent {
  id: string;
  ticketId: string;
  eventType: string;
  operatorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  operatorId: string | null;
  note: string | null;
  createdAt: string;
}

/** admin 工单项（AdminTicket = Ticket + escalated/userId） */
export interface AdminTicket {
  id: string;
  ticketNo: string;
  status: TicketStatus;
  type: TicketType;
  sourceType: string;
  sourceId: string;
  firstRespDue: string | null;
  resolveDue: string | null;
  escalated: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

/** admin 工单详情（P2-1：内联时间线全量 asc，detail 一次取数） */
export interface AdminTicketDetail extends AdminTicket {
  events: TicketEvent[];
}

/** 列表响应 data（游标分页） */
export interface AdminTicketListResult {
  items: AdminTicket[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** 列表查询参数 */
export interface ListTicketsParams {
  status?: TicketStatus;
  escalated?: boolean;
  limit?: number;
}

/** 状态流转请求（action=目标状态；note 选填 ≤500） */
export interface UpdateTicketStatusInput {
  action: TicketStatus;
  note?: string;
}

/** D18 线性流转表（与后端 allowed map 同源；前端仅做按钮可用性预判，权威在后端） */
export const TICKET_ALLOWED_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

/** 列表（游标分页 + 加载更多） */
export function useAdminTickets(params: ListTicketsParams = {}, opts?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: ['admin-tickets', params],
    queryFn: async ({ pageParam }) => {
      const sp = new URLSearchParams();
      if (params.status) sp.set('status', params.status);
      if (params.escalated !== undefined) sp.set('escalated', String(params.escalated));
      if (params.limit) sp.set('limit', String(params.limit));
      if (pageParam) sp.set('cursor', pageParam);
      const query = sp.toString();
      const res = await apiFetch<ApiSuccess<AdminTicketListResult>>(
        `/admin/tickets${query ? `?${query}` : ''}`,
      );
      return res.data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: opts?.enabled ?? true,
  });
}

/** 详情（按 ticketNo 寻址，D20 业务主键；含内联时间线 events） */
export function useAdminTicketDetail(ticketNo: string | undefined) {
  return useQuery({
    enabled: !!ticketNo,
    queryKey: ['admin-tickets', 'detail', ticketNo],
    queryFn: () =>
      apiFetch<ApiSuccess<AdminTicketDetail>>(`/admin/tickets/${ticketNo}`).then((res) => res.data),
  });
}

/** 状态流转（成功后失效列表 + 详情缓存） */
export function useUpdateTicketStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketNo, input }: { ticketNo: string; input: UpdateTicketStatusInput }) =>
      apiFetch<ApiSuccess<AdminTicket>>(`/admin/tickets/${ticketNo}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }).then((res) => res.data),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['admin-tickets'] });
      void qc.invalidateQueries({ queryKey: ['admin-tickets', 'detail', data.ticketNo] });
    },
  });
}
