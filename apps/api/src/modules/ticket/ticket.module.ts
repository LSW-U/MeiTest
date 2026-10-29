/**
 * Ticket Module — 工单模块（替换品批2 工单化，2026-10-29）
 *
 * 注册：
 *   - TicketNoService（工单号生成，照抄 OrderNoService）
 *   - TicketService（时限解析 + 查询 + 建单）
 *   - ClientTicketController（/api/v1/client/tickets）
 *
 * 消费方：
 *   - DispatchModule（reportIssue 旁路建单，D20）
 */
import { Module } from '@nestjs/common';
import { TicketNoService } from './ticket-no.service';
import { TicketService } from './ticket.service';
import { ClientTicketController } from './ticket.controller';

@Module({
  controllers: [ClientTicketController],
  providers: [TicketNoService, TicketService],
  exports: [TicketNoService, TicketService],
})
export class TicketModule {}
