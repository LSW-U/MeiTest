/**
 * Collaborative Filtering Scheduler — 批6 离线重算定时注册（BullMQ repeatable job）
 *
 * P3-2 修复（2026-10-18）：cron 按 recomputeCronHours 配置注册（默认 6h，1-168h），
 * G5「重算频率可配」真实生效——配置变更后随下次重启（或手动触发）按新频率注册。
 * 秒位错开整点（fleet 同期撞 API 防护，同 engagement.scheduler 范式）。
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { COLLABORATIVE_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import { getCollaborativeConfig } from './collaborative.config';
import type { RecomputeResult } from './collaborative-filter.service';
import { COLLABORATIVE_JOB_RECOMPUTE } from './collaborative.processor';

export const COLLABORATIVE_REPEAT_KEY = 'collaborative-recompute';
const COLLABORATIVE_CRON_TZ = 'Asia/Dili';

@Injectable()
export class CollaborativeScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(COLLABORATIVE_QUEUE)
    private readonly queue: Queue<Record<string, never>, RecomputeResult>,
  ) {}

  /**
   * 按 recomputeCronHours 生成秒位错开的 cron 表达式（分钟位固定 37 防雷群）：
   * 1h → "37 * * * *"；6h → "37 0 *\/6 * *"；24h → "37 0 *\/24 * *"。
   */
  private buildCronPattern(hours: number): string {
    return hours === 1 ? '37 * * * *' : `37 0 */${hours} * *`;
  }

  async onModuleInit(): Promise<void> {
    const cfg = await getCollaborativeConfig();
    const pattern = this.buildCronPattern(cfg.recomputeCronHours);
    // 审查红线（settle/coupon-expire/engagement 同款）：repeat job 不能同时指定 jobId
    await this.queue.add(
      COLLABORATIVE_JOB_RECOMPUTE,
      {} as Record<string, never>,
      {
        repeat: {
          pattern,
          tz: COLLABORATIVE_CRON_TZ,
          key: COLLABORATIVE_REPEAT_KEY,
        },
      },
    );
    logger.info({
      msg: 'collaborative_scheduler_registered',
      pattern,
      tz: COLLABORATIVE_CRON_TZ,
      recomputeCronHours: cfg.recomputeCronHours,
    });
  }
}
