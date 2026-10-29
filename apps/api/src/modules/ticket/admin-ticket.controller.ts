/**
 * Admin Ticket Controller — 客服工单工作台路由（替换品批3，2026-10-30 D22）
 *
 * 端点（/api/v1/admin/tickets）：
 *   GET  /                  工单分页列表（状态/escalated 筛选，游标）
 *   GET  /:ticketNo         工单详情
 *   POST /:ticketNo/status  状态流转（D18 四态线性 OPEN→IN_PROGRESS→RESOLVED→CLOSED）
 *
 * D22：独立客服角色守卫——CUSTOMER_SERVICE + SUPER_ADMIN 可读写（不挂 SUPER_ADMIN 类级），
 * P2-2 落点：客服（非超管）可处理工单，封号用户的工单仍可查可处理。
 * 写端点 @Audit（POST 默认审计，resource 显式声明）。
 */
import { Controller, Get, Post, Param, Query, Body, Req, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { TicketService } from './ticket.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

/** admin 工单列表查询（游标分页 + 状态/escalated 筛选） */
const AdminListTicketsQuery = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  escalated: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** 状态流转请求（D18：action 即目标状态，四态线性） */
const UpdateTicketStatusRequest = z.object({
  action: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
  note: z.string().max(500).optional(),
});

@Controller('api/v1/admin/tickets')
@Roles('SUPER_ADMIN', 'CUSTOMER_SERVICE')
export class AdminTicketController {
  constructor(@Inject(TicketService) private readonly ticketService: TicketService) {}

  /** 工单分页列表（状态/escalated 筛选） */
  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminListTicketsQuery))
    query: z.infer<typeof AdminListTicketsQuery>,
  ) {
    const result = await this.ticketService.listAdminTickets({
      status: query.status,
      escalated: query.escalated,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 工单详情（含 escalated/userId admin 字段；时间线走 GET /:ticketNo/events 用户端点同构——admin 复用 Service 时间线不做归属过滤见 detail） */
  @Get(':ticketNo')
  async detail(@Param('ticketNo') ticketNo: string) {
    const ticket = await this.ticketService.getAdminTicketByNo(ticketNo);
    return { success: true as const, data: ticket };
  }

  /** 状态流转（D18 四态线性；非法流转 409 E-TICKET-002 / 同态 400 E-TICKET-003） */
  @Post(':ticketNo/status')
  @Audit({ resource: 'Ticket', resourceIdParam: 'ticketNo' })
  async updateStatus(
    @Param('ticketNo') ticketNo: string,
    @Body(new ZodValidationPipe(UpdateTicketStatusRequest)) body: z.infer<typeof UpdateTicketStatusRequest>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const ticket = await this.ticketService.updateTicketStatus({
      ticketNo,
      action: body.action,
      operatorId: req.user.sub,
      note: body.note,
    });
    return { success: true as const, data: ticket };
  }
}
