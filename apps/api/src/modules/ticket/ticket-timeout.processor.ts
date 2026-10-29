/**
 * Ticket Timeout Processor — 工单超时升级扫描（BullMQ WorkerHost）
 *
 * 替换品批3（2026-10-30 D18）：
 *   - 每 5min 扫「超时未达标」工单：非 RESOLVED/CLOSED 且
 *     (firstRespDue 已过但无 admin 首响) 或 (resolveDue 已过)
 *   - 首响判定：TicketEvent 有 ADMIN/STATUS_CHANGED 或 RESOLVED 即视为已响应
 *     （简化口径：IN_PROGRESS/RESOLVED/CLOSED 均视为已被客服触碰；OPEN + firstRespDue 过期 = 首响超时）
 *   - resolveDue 过期且非终态 = 解决超时
 *   - 命中 → TicketService.escalateTicket（幂等）→ WS 推 customer-service room
 *     （复用 reportIssue room，事件名 ticket:escalated）+ PUSH ticketEscalated 模板
 *
 * 容错：单条失败不影响其余（逐条 try/catch），单次扫描失败不影响下次。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { TICKET_TIMEOUT_QUEUE } from '../../shared/queue';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { NotificationEventService } from '../notification/notification-event.service';
import { TicketService } from './ticket.service';

export interface TicketTimeoutJobData {
  /** 占位（repeat job 无业务参数）；预留手动触发用 */
  dryRun?: boolean;
}

export interface TicketTimeoutJobResult {
  escalated: number;
  dryRun: boolean;
}

/** 客服 WS room（复用 reportIssue 的 customer-service room，D18） */
const CUSTOMER_SERVICE_ROOM = 'customer-service';

@Processor(TICKET_TIMEOUT_QUEUE, { concurrency: 1 })
export class TicketTimeoutProcessor extends WorkerHost {
  constructor(
    // DI 显式 token（tsx 无 decorator metadata；ticket.module 注册 useExisting）
    @Inject('TICKET_TIMEOUT_TICKET_SERVICE')
    private readonly ticketService: TicketService | null,
    @Inject(RealtimeGateway) private readonly realtime: RealtimeGateway,
    @Optional() @Inject('NotificationEventServiceToken')
    private readonly notificationEvents?: NotificationEventService | null,
  ) {
    super();
  }

  async process(job: Job<TicketTimeoutJobData, TicketTimeoutJobResult>): Promise<TicketTimeoutJobResult> {
    if (job.name !== 'escalate-overdue-tickets') {
      logger.warn({ msg: 'ticket_timeout_unknown_job', jobName: job.name });
      return { escalated: 0, dryRun: false };
    }
    if (job.data?.dryRun === true) {
      logger.info({ msg: 'ticket_timeout_dry_run_skip' });
      return { escalated: 0, dryRun: true };
    }

    const now = new Date();

    // 1. 扫超时未达标工单：
    //    - 首响超时：OPEN + firstRespDue < now（OPEN = 无 admin 触碰，IN_PROGRESS 视为已首响）
    //    - 解决超时：resolveDue < now 且 status ∈ {OPEN, IN_PROGRESS}（RESOLVED/CLOSED 已达标）
    const overdue = await db.ticket.findMany({
      where: {
        escalated: false,
        OR: [
          { status: 'OPEN', firstRespDue: { lt: now } },
          { status: 'IN_PROGRESS', resolveDue: { lt: now } },
          { status: 'OPEN', resolveDue: { lt: now } },
        ],
      },
      select: { id: true, ticketNo: true, userId: true },
    });

    let escalated = 0;
    for (const t of overdue) {
      try {
        const first = await this.ticketService?.escalateTicket(t.id);
        if (!first) continue; // 已置位（并发轮次）→ 幂等跳过
        escalated += 1;

        // 2. WS 推 customer-service room（事务外，失败容忍——同 reportIssue 模式）
        try {
          this.realtime.server.to(CUSTOMER_SERVICE_ROOM).emit('ticket:escalated', {
            ticketNo: t.ticketNo,
            userId: t.userId,
            timestamp: now.toISOString(),
          });
        } catch (e) {
          logger.warn({
            msg: 'TICKET_ESCALATED_WS_FAILED',
            ticketNo: t.ticketNo,
            error: (e as Error).message,
          });
        }

        // 3. PUSH（受众 CUSTOMER：告知用户工单已升级，客服将优先处理；失败容忍）
        if (this.notificationEvents) {
          await this.notificationEvents.notify({
            event: 'ticketEscalated',
            userId: t.userId,
            type: 'ORDER_UPDATE',
            data: { ticketNo: t.ticketNo },
            params: { ticketNo: t.ticketNo },
          });
        }
      } catch (e) {
        logger.warn({
          msg: 'TICKET_ESCALATE_FAILED',
          ticketNo: t.ticketNo,
          error: (e as Error).message,
        });
      }
    }

    if (escalated > 0) {
      logger.info({ msg: 'TICKET_TIMEOUT_ESCALATED', count: escalated });
    }
    return { escalated, dryRun: false };
  }
}
