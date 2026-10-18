/**
 * Engagement Scheduler — 批4 触达自动化定时注册（BullMQ repeatable job）
 *
 * 每 30min 跑一次 run-all（六流幂等，重复扫描无害；B2/B3 窗口小时级语义足够）。
 * 秒位错开整点/半点（fleet 同期撞 API 防护，同 coupon-expire.scheduler 范式）。
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ENGAGEMENT_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import type { EngagementJobData } from './engagement.processor';

const ENGAGEMENT_REPEAT_KEY = 'engagement-run-all-every-30min';
const ENGAGEMENT_CRON_PATTERN = '13,43 * * * *';
const ENGAGEMENT_CRON_TZ = 'Asia/Dili';

export const ENGAGEMENT_JOB_RUN_ALL = 'run-all';

@Injectable()
export class EngagementScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ENGAGEMENT_QUEUE) private readonly queue: Queue<EngagementJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    // 审查红线（settle/coupon-expire 同款）：repeat job 不能同时指定 jobId
    await this.queue.add(
      ENGAGEMENT_JOB_RUN_ALL,
      {} as EngagementJobData,
      {
        repeat: {
          pattern: ENGAGEMENT_CRON_PATTERN,
          tz: ENGAGEMENT_CRON_TZ,
          key: ENGAGEMENT_REPEAT_KEY,
        },
      },
    );
    logger.info({
      msg: 'engagement_scheduler_registered',
      pattern: ENGAGEMENT_CRON_PATTERN,
      tz: ENGAGEMENT_CRON_TZ,
    });
  }
}
