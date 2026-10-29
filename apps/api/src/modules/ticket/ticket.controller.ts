/**
 * Ticket Controller — 用户工单路由（替换品批2 工单化，2026-10-29）
 *
 * 端点（/api/v1/client/tickets）：
 *   GET  /                  我的工单分页列表（游标）
 *   GET  /:ticketNo         工单详情（按 ticketNo 业务键寻址）
 *   GET  /:ticketNo/events  时间线分页（D16）
 *
 * 仅 CUSTOMER 视角查询；建单走 reportIssue 旁路（D20），本模块批2 无写端点。
 */
import { Controller, Get, Param, Query, Req, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { TicketService } from './ticket.service';
import { ZodValidationPipe } from '../../shared/pipes/zod-validation.pipe';
import { Roles } from '../../shared/decorators/roles.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

interface RequestWithUser {
  user?: RequestUser;
  headers: Record<string, string | string[] | undefined>;
}

/** 游标分页查询（与 admin refunds 同款参数） */
const ListTicketsQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

@Controller('api/v1/client/tickets')
export class ClientTicketController {
  constructor(@Inject(TicketService) private readonly ticketService: TicketService) {}

  /** 我的工单列表 */
  @Get()
  @Roles('CUSTOMER')
  async list(
    @Query(new ZodValidationPipe(ListTicketsQuery)) query: z.infer<typeof ListTicketsQuery>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.ticketService.listUserTickets({
      userId: req.user.sub,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }

  /** 工单详情 */
  @Get(':ticketNo')
  @Roles('CUSTOMER')
  async detail(@Param('ticketNo') ticketNo: string, @Req() req: RequestWithUser) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const ticket = await this.ticketService.getTicketByNo(ticketNo, req.user.sub);
    return { success: true as const, data: ticket };
  }

  /** 时间线分页 */
  @Get(':ticketNo/events')
  @Roles('CUSTOMER')
  async events(
    @Param('ticketNo') ticketNo: string,
    @Query(new ZodValidationPipe(ListTicketsQuery)) query: z.infer<typeof ListTicketsQuery>,
    @Req() req: RequestWithUser,
  ) {
    if (!req.user) {
      throw new HttpException({ code: 'E-AUTH-002', message: 'auth required' }, HttpStatus.UNAUTHORIZED);
    }
    const result = await this.ticketService.listTicketEvents({
      ticketNo,
      userId: req.user.sub,
      cursor: query.cursor,
      limit: query.limit,
    });
    return { success: true as const, data: result };
  }
}
