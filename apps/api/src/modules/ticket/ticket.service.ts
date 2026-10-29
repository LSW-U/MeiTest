/**
 * Ticket Service — 工单核心（替换品批2 工单化，2026-10-29）
 *
 * 决策依据（方案v2）：
 *   - D10：独立 Ticket model（不升级 Feedback），reportIssue 旁路建单
 *   - D11：时限按 key 链解析——类型覆盖 > 全局 > 代码默认(24/48)
 *   - D12：ticketNo 由 TicketNoService 生成（TK + yyyyMMdd + seq(6)）
 *   - D16：时间线走 TicketEvent 子表（分页）
 *   - D19：@@unique([sourceType, sourceId]) 同源幂等（捕 P2002 返回既有票）
 *
 * 批2 边界：只建 OPEN 态；流转/升级/审计视角在批3 admin 工作台。
 */
import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus, TicketType } from '../../prisma/client';
import { db } from '../../shared/db';
import { TicketNoService } from './ticket-no.service';

/** 时限默认值（D11 代码默认档：首响 24h / 解决 48h） */
export const DEFAULT_FIRST_RESPONSE_HOURS = 24;
export const DEFAULT_RESOLVE_HOURS = 48;

/** SystemConfig key（D11） */
export const TICKET_FIRST_RESPONSE_KEY = 'ticket.first_response_hours';
export const TICKET_RESOLVE_KEY = 'ticket.resolve_hours';
export const TICKET_FIRST_RESPONSE_TYPE_KEY_PREFIX = 'ticket.first_response_hours.';
export const TICKET_RESOLVE_TYPE_KEY_PREFIX = 'ticket.resolve_hours.';

/** reportIssue 旁路建单来源 */
export const TICKET_SOURCE_DELIVERY_ISSUE = 'DELIVERY_ISSUE';

/** 工单用户视角视图 */
export interface TicketView {
  id: string;
  ticketNo: string;
  status: TicketStatus;
  type: TicketType;
  sourceType: string;
  sourceId: string;
  /** 承诺时限（可空 = 配置缺失降级，用户端隐藏倒计时即可） */
  firstRespDue: string | null;
  resolveDue: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 工单时间线事件视图 */
export interface TicketEventView {
  id: string;
  ticketId: string;
  eventType: string;
  operatorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM';
  operatorId: string | null;
  note: string | null;
  createdAt: string;
}

@Injectable()
export class TicketService {
  constructor(@Inject(TicketNoService) private readonly ticketNoService: TicketNoService) {}

  /**
   * 旁路建单（D10/D19）：reportIssue 成功后调用
   *
   * - 幂等：先查 sourceType+sourceId 唯一，命中直接返回既有票（并发窗口捕 P2002 同样返回既有票）
   * - 事件：写 TicketEvent(eventType='CREATED', operatorType='SYSTEM', note=reportIssue note)
   * - 时限：建单时按 D11 key 链算出（配置缺失 → null，不阻塞建单）
   *
   * @returns 新建或既有的 ticket（含 ticketNo）
   */
  async createFromDeliveryIssue(params: {
    sourceId: string;
    userId: string;
    type: TicketType;
    note?: string;
    operatorId?: string;
  }): Promise<TicketView> {
    const existing = await db.ticket.findUnique({
      where: { sourceType_sourceId: { sourceType: TICKET_SOURCE_DELIVERY_ISSUE, sourceId: params.sourceId } },
    });
    if (existing) {
      return this.toView(existing);
    }

    // D11：时限在建单时算出（读取失败降级 null，不阻塞建单）
    const { firstRespDue, resolveDue } = await this.resolveDeadlines(params.type);

    const ticketNo = await this.ticketNoService.nextTicketNo();
    try {
      const ticket = await db.ticket.create({
        data: {
          ticketNo,
          status: 'OPEN',
          type: params.type,
          sourceType: TICKET_SOURCE_DELIVERY_ISSUE,
          sourceId: params.sourceId,
          firstRespDue,
          resolveDue,
          escalated: false,
          userId: params.userId,
          events: {
            create: {
              eventType: 'CREATED',
              operatorType: 'SYSTEM',
              operatorId: params.operatorId ?? null,
              note: params.note ?? null,
            },
          },
        },
      });
      return this.toView(ticket);
    } catch (e) {
      // D19 并发幂等：唯一约束冲突 → 另一请求已建票，返回既有票
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const raced = await db.ticket.findUnique({
          where: { sourceType_sourceId: { sourceType: TICKET_SOURCE_DELIVERY_ISSUE, sourceId: params.sourceId } },
        });
        if (raced) {
          return this.toView(raced);
        }
      }
      throw e;
    }
  }

  /**
   * D11 时限解析：类型覆盖 > 全局 > 代码默认
   *
   * 读取/解析失败 → 降级下一档；全部失败 → null（用户端隐藏倒计时）。
   * value 为小时数（正数），deadline = now + hours。
   */
  async resolveDeadlines(
    type: TicketType,
  ): Promise<{ firstRespDue: Date | null; resolveDue: Date | null }> {
    const [firstRespHours, resolveHours] = await Promise.all([
      this.resolveHours(TICKET_FIRST_RESPONSE_KEY, TICKET_FIRST_RESPONSE_TYPE_KEY_PREFIX, type, DEFAULT_FIRST_RESPONSE_HOURS),
      this.resolveHours(TICKET_RESOLVE_KEY, TICKET_RESOLVE_TYPE_KEY_PREFIX, type, DEFAULT_RESOLVE_HOURS),
    ]);
    const now = Date.now();
    return {
      firstRespDue: firstRespHours !== null ? new Date(now + firstRespHours * 3600_000) : null,
      resolveDue: resolveHours !== null ? new Date(now + resolveHours * 3600_000) : null,
    };
  }

  /**
   * 单项时限解析（D11 key 链）
   *
   * @returns 小时数；配置缺失/非法 → null（调用方降级）
   */
  private async resolveHours(
    globalKey: string,
    typeKeyPrefix: string,
    type: TicketType,
    fallback: number,
  ): Promise<number | null> {
    const readConfig = async (key: string): Promise<number | null> => {
      const cfg = await db.systemConfig.findUnique({ where: { key }, select: { value: true } });
      const n = Number(cfg?.value);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // 1. 类型覆盖：ticket.first_response_hours.{type}
    const typeHours = await readConfig(`${typeKeyPrefix}${type}`);
    if (typeHours !== null) return typeHours;
    // 2. 全局：ticket.first_response_hours
    const globalHours = await readConfig(globalKey);
    if (globalHours !== null) return globalHours;
    // 3. 代码默认（24/48）
    return fallback;
  }

  /** 我的工单分页列表（游标） */
  async listUserTickets(options: {
    userId: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: TicketView[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(options.limit ?? 20, 100);
    const tickets = await db.ticket.findMany({
      where: { userId: options.userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = tickets.length > limit;
    const items = hasMore ? tickets.slice(0, limit) : tickets;
    return {
      items: items.map((t) => this.toView(t)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
    };
  }

  /** 工单详情（按 ticketNo 业务键寻址；非本人 404 防枚举） */
  async getTicketByNo(ticketNo: string, userId: string): Promise<TicketView> {
    const ticket = await db.ticket.findUnique({ where: { ticketNo } });
    // 非本人与不存在统一 404（防枚举）
    if (!ticket || ticket.userId !== userId) {
      throw new NotFoundException({ code: 'E-TICKET-001', message: 'Ticket not found' });
    }
    return this.toView(ticket);
  }

  /** 时间线分页（D16，按 createdAt asc） */
  async listTicketEvents(options: {
    ticketNo: string;
    userId: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: TicketEventView[]; nextCursor: string | null; hasMore: boolean }> {
    const ticket = await db.ticket.findUnique({ where: { ticketNo: options.ticketNo } });
    if (!ticket || ticket.userId !== options.userId) {
      throw new NotFoundException({ code: 'E-TICKET-001', message: 'Ticket not found' });
    }
    const limit = Math.min(options.limit ?? 50, 100);
    const events = await db.ticketEvent.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });
    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, limit) : events;
    return {
      items: items.map((ev) => this.toEventView(ev)),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
    };
  }

  // === private ===

  private toView(t: {
    id: string;
    ticketNo: string;
    status: TicketStatus;
    type: TicketType;
    sourceType: string;
    sourceId: string;
    firstRespDue: Date | null;
    resolveDue: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): TicketView {
    return {
      id: t.id,
      ticketNo: t.ticketNo,
      status: t.status,
      type: t.type,
      sourceType: t.sourceType,
      sourceId: t.sourceId,
      firstRespDue: t.firstRespDue?.toISOString() ?? null,
      resolveDue: t.resolveDue?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toEventView(ev: {
    id: string;
    ticketId: string;
    eventType: string;
    operatorType: string;
    operatorId: string | null;
    note: string | null;
    createdAt: Date;
  }): TicketEventView {
    return {
      id: ev.id,
      ticketId: ev.ticketId,
      eventType: ev.eventType,
      operatorType: ev.operatorType as TicketEventView['operatorType'],
      operatorId: ev.operatorId,
      note: ev.note,
      createdAt: ev.createdAt.toISOString(),
    };
  }
}
