/**
 * Settle Scheduler — T+1 定时任务注册（BullMQ repeatable job）
 *
 * 设计要点：
 *   - onModuleInit 时幂等注册 repeatable job（BullMQ 内部按 repeat pattern + key 去重）
 *   - 多实例部署时不会重复触发（BullMQ 由 Redis 协调单 worker 拿到任务）
 *   - 时区 Asia/Dili（UTC+9），02:00 跑前一日结算（T+1）
 *
 * 决策依据：
 *   - W2-M-MANIFEST-W3.md §6：T+1 02:00 Asia/Dili
 *   - 决策 2026-06-24：T+1 频率，periodDate 参数支持周/月结扩展
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { SETTLE_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import type { RunSettlementJobData } from './settle.processor';

/** 重复任务去重 key（BullMQ 用此 key + pattern 判等） */
const SETTLE_REPEAT_KEY = 'settle-t1-daily';

/** T+1 cron：每天 02:00 Asia/Dili */
const SETTLE_CRON_PATTERN = '0 2 * * *';
const SETTLE_CRON_TZ = 'Asia/Dili';

/** 手动触发时使用的 job name（与定时任务同 processor 处理） */
export const SETTLE_JOB_RUN = 'run-settlement';

@Injectable()
export class SettleScheduler implements OnModuleInit {
  constructor(@InjectQueue(SETTLE_QUEUE) private readonly queue: Queue<RunSettlementJobData>) {}

  async onModuleInit(): Promise<void> {
    // 审查报告 P1 #8：BullMQ 文档明确禁止 repeat job 同时指定 jobId（repeat.key 已是去重 key）
    // 审查报告 P1 #10：removeOnComplete/Fail 让 SettleModule.registerQueue 的 default 生效
    await this.queue.add(
      SETTLE_JOB_RUN,
      {} as RunSettlementJobData,
      {
        repeat: { pattern: SETTLE_CRON_PATTERN, tz: SETTLE_CRON_TZ, key: SETTLE_REPEAT_KEY },
      },
    );
    logger.info({
      msg: 'settle_scheduler_registered',
      pattern: SETTLE_CRON_PATTERN,
      tz: SETTLE_CRON_TZ,
    });
  }
}
