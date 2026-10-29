/**
 * Ticket 模块契约 schema（替换品批2 工单化，方案v2 D10/D15/D16/D19/D20，2026-10-29）
 *
 * 端点：
 *   GET /client/tickets                    用户工单分页列表（游标）
 *   GET /client/tickets/:ticketNo          工单详情
 *   GET /client/tickets/:ticketNo/events   时间线分页（D16）
 *
 * 设计：
 *   - TicketType 五枚举直接继承 reportIssue reason + FEEDBACK 预留（D15，两套不翻译）
 *   - TicketStatus 四态（D18）；批2 只建 OPEN，流转在批3 admin 工作台
 *   - 用户视角不透出 escalated（内部 SLA 标记，用户进度页无消费场景）
 *   - ticketNo 是用户侧业务主键（D20 回显 TKxxx），端点按 ticketNo 寻址非 id
 */
import { z } from 'zod';
import { Id, IsoTimestamp, PaginatedResponse } from './common';

/** 工单状态（D18 四态） */
export const TicketStatus = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);

/** 工单类型（D15：reportIssue 五枚举 + FEEDBACK 预留） */
export const TicketType = z.enum([
  'CUSTOMER_UNREACHABLE',
  'CUSTOMER_REJECTED',
  'ADDRESS_NOT_FOUND',
  'TRAFFIC_ACCIDENT',
  'OTHER',
  'FEEDBACK',
]);

/** 时间线事件操作人类型（D16 三值） */
export const TicketOperatorType = z.enum(['CUSTOMER', 'ADMIN', 'SYSTEM']);

/** 工单列表/详情项（用户视角） */
export const Ticket = z.object({
  id: Id,
  /** 工单号（D12：TK + yyyyMMdd + seq(6)） */
  ticketNo: z.string(),
  status: TicketStatus,
  type: TicketType,
  /** 来源（DELIVERY_ISSUE / 预留） */
  sourceType: z.string(),
  sourceId: z.string(),
  /** 承诺时限（D11 建单时算出；可空 = 配置缺失降级） */
  firstRespDue: IsoTimestamp.nullable(),
  resolveDue: IsoTimestamp.nullable(),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});

/** 时间线事件（D16） */
export const TicketEvent = z.object({
  id: Id,
  ticketId: Id,
  eventType: z.string(),
  operatorType: TicketOperatorType,
  operatorId: Id.nullable(),
  note: z.string().nullable(),
  createdAt: IsoTimestamp,
});

/** 列表响应（游标分页） */
export const TicketListResponse = PaginatedResponse(Ticket);

/** 详情响应 */
export const TicketDetailResponse = z.object({
  success: z.literal(true),
  data: Ticket,
});

/** 时间线分页响应（D16） */
export const TicketEventListResponse = PaginatedResponse(TicketEvent);

// ============================================================================
// 批3（2026-10-30 D18/D22）：admin 工单工作台
// ============================================================================

/** admin 工单项（用户视角字段 + escalated/userId 内部字段） */
export const AdminTicket = Ticket.extend({
  /** 超时升级标记（D18，admin 筛选/高亮） */
  escalated: z.boolean(),
  /** 提单用户（admin 反查） */
  userId: Id,
});

/**
 * admin 工单详情（P2-1 批3 审查修复 2026-10-30）：详情专有内联时间线全量 asc
 * （detail Dialog 一次取数免分页；量级 = 工单生命周期事件，无分页需求）
 */
export const AdminTicketDetail = AdminTicket.extend({
  events: z.array(TicketEvent),
});

/** admin 列表查询（游标分页 + 状态/escalated 筛选） */
export const AdminListTicketsQuery = z.object({
  status: TicketStatus.optional(),
  escalated: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** admin 状态流转请求（D18 四态线性：action 即目标状态） */
export const AdminUpdateTicketStatusRequest = z.object({
  action: TicketStatus,
  note: z.string().max(500).optional(),
});

/** admin 列表响应 */
export const AdminTicketListResponse = PaginatedResponse(AdminTicket);

/** admin 详情响应（含内联时间线 events，P2-1） */
export const AdminTicketDetailResponse = z.object({
  success: z.literal(true),
  data: AdminTicketDetail,
});

/** admin 状态流转响应 */
export const AdminTicketStatusResponse = AdminTicketDetailResponse;
