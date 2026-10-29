/**
 * Ticket Module — 工单模块（替换品批2 工单化 2026-10-29 / 批3 超时升级+admin 工作台 2026-10-30）
 *
 * 注册：
 *   - TicketNoService（工单号生成，照抄 OrderNoService）
 *   - TicketService（时限解析 + 查询 + 建单 + 批3 admin 流转/升级）
 *   - ClientTicketController（/api/v1/client/tickets）
 *   - AdminTicketController（批3 D22：/api/v1/admin/tickets，客服角色读写）
 *   - TicketTimeoutScheduler + TicketTimeoutProcessor（批3 D18：超时升级队列）
 *
 * 消费方：
 *   - DispatchModule（reportIssue 旁路建单，D20）
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TicketNoService } from './ticket-no.service';
import { TicketService } from './ticket.service';
import { ClientTicketController } from './ticket.controller';
import { AdminTicketController } from './admin-ticket.controller';
import { TicketTimeoutScheduler } from './ticket-timeout.scheduler';
import { TicketTimeoutProcessor } from './ticket-timeout.processor';
import { TICKET_TIMEOUT_QUEUE } from '../../shared/queue';
import { RealtimeModule } from '../realtime/realtime.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationModule } from '../notification/notification.module';
import { NotificationEventService } from '../notification/notification-event.service';

@Module({
  imports: [
    RealtimeModule,
    NotificationModule,
    BullModule.registerQueue({ name: TICKET_TIMEOUT_QUEUE }),
  ],
  controllers: [ClientTicketController, AdminTicketController],
  providers: [
    TicketNoService,
    TicketService,
    TicketTimeoutScheduler,
    TicketTimeoutProcessor,
    // 显式声明 DI token，避免 tsx esbuild 不生成 emitDecoratorMetadata 导致 Inject token 无法解析
    { provide: 'RealtimeGatewayToken', useExisting: RealtimeGateway },
    { provide: 'NotificationEventServiceToken', useExisting: NotificationEventService },
    // 批3 D18：processor 取 TicketService 的显式 token
    { provide: 'TICKET_TIMEOUT_TICKET_SERVICE', useExisting: TicketService },
  ],
  exports: [TicketNoService, TicketService],
})
export class TicketModule {}
