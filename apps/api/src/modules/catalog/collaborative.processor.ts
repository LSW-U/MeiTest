/**
 * Collaborative Filtering Processor — BullMQ 消费者（批6，2026-10-18）
 *
 * job name：
 *   'recompute'  离线全量重算（scheduler 定时 + 运维手动触发）
 *
 * 范式照抄 engagement.processor.ts（WorkerHost + 单并发；重算幂等——
 * delete+insert 在同一事务，重复执行无害）。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { COLLABORATIVE_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import { COLLABORATIVE_FILTER_TOKEN } from './catalog.service';
import { CollaborativeFilterService } from './collaborative-filter.service';
import type { RecomputeResult } from './collaborative-filter.service';

@Processor(COLLABORATIVE_QUEUE, { concurrency: 1 })
export class CollaborativeProcessor extends WorkerHost {
  // 显式 @Inject token（tsx 不 emit 装饰器元数据——本仓红线，boot 冒烟实证）
  constructor(
    @Inject(COLLABORATIVE_FILTER_TOKEN) private readonly collab: CollaborativeFilterService,
  ) {
    super();
  }

  async process(job: Job<Record<string, never>, RecomputeResult>): Promise<RecomputeResult> {
    if (job.name !== COLLABORATIVE_JOB_RECOMPUTE) {
      logger.warn({ msg: 'COLLABORATIVE_UNKNOWN_JOB', name: job.name });
      return { users: 0, picks: 0, elapsedMs: 0 };
    }
    return this.collab.recomputeAll();
  }
}

export const COLLABORATIVE_JOB_RECOMPUTE = 'recompute';
