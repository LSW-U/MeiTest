/**
 * Ticket Timeout Scheduler — 工单超时升级扫描注册（BullMQ repeatable job）
 *
 * 替换品批3（2026-10-30 D18）：照 coupon-expire/suggestion-timeout.scheduler 模式
 *   - onModuleInit 幂等注册 repeatable job（BullMQ 按 repeat pattern + key 去重）
 *   - 每 5min 扫超时未达标工单（firstRespDue/resolveDue 已过且非 RESOLVED/CLOSED）
 *     → escalated=true + WS 推 customer-service room + PUSH
 *   - repeat job 禁 jobId（settle.scheduler 审查先例）
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { TICKET_TIMEOUT_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import type { TicketTimeoutJobData } from './ticket-timeout.processor';

/** 重复任务去重 key */
const TICKET_TIMEOUT_REPEAT_KEY = 'ticket-timeout-every-5min';

/** 每 5 分钟跑一次 */
const TICKET_TIMEOUT_CRON_PATTERN = '*/5 * * * *';
const TICKET_TIMEOUT_CRON_TZ = 'Asia/Dili';

/** 手动触发时用的 job name（与定时任务同 processor 处理） */
export const TICKET_TIMEOUT_JOB_RUN = 'escalate-overdue-tickets';

@Injectable()
export class TicketTimeoutScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(TICKET_TIMEOUT_QUEUE) private readonly queue: Queue<TicketTimeoutJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    // repeat job 禁 jobId（审查报告先例）
    await this.queue.add(
      TICKET_TIMEOUT_JOB_RUN,
      {} as TicketTimeoutJobData,
      {
        repeat: { pattern: TICKET_TIMEOUT_CRON_PATTERN, tz: TICKET_TIMEOUT_CRON_TZ, key: TICKET_TIMEOUT_REPEAT_KEY },
      },
    );
    logger.info({
      msg: 'ticket_timeout_scheduler_registered',
      pattern: TICKET_TIMEOUT_CRON_PATTERN,
      tz: TICKET_TIMEOUT_CRON_TZ,
    });
  }
}
