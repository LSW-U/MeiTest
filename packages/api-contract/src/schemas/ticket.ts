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
