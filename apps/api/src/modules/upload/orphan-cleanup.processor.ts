/**
 * Orphan Cleanup Processor — BullMQ 消费者（upload 模块批C U4，2026-09-10）
 *
 * 消费 orphan-cleanup 队列的 cleanup-orphans job → OrphanCleanupService.runCleanup。
 * job data.execute 决定 dry-run / 真删（定时注册默认 dry-run，见 scheduler）。
 *
 * 结果：OrphanCleanupSummary（清理日志可审计，任务书批C 要求）。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { logger } from '../../shared/logger/logger';
import { ORPHAN_CLEANUP_QUEUE } from '../../shared/queue';
import { OrphanCleanupService } from './orphan-cleanup.service';
import type { OrphanCleanupSummary } from './orphan-cleanup.service';

/** 孤儿清理 job 数据 */
export interface OrphanCleanupJobData {
  /** true=真删；false/缺省=dry-run（默认安全） */
  execute?: boolean;
}

@Processor(ORPHAN_CLEANUP_QUEUE, { concurrency: 1 })
export class OrphanCleanupProcessor extends WorkerHost {
  constructor(
    // tsx 无 decorator metadata：显式 @Inject（单测可 new Processor(mock)）
    @Inject(OrphanCleanupService)
    private readonly cleanupService: OrphanCleanupService,
  ) {
    super();
  }

  async process(
    job: Job<OrphanCleanupJobData, OrphanCleanupSummary>,
  ): Promise<OrphanCleanupSummary> {
    const execute = job.data?.execute ?? false;
    logger.info({
      msg: 'orphan_cleanup_job_start',
      jobId: job.id,
      execute,
      attempt: job.attemptsMade + 1,
    });
    return this.cleanupService.runCleanup({ execute });
  }
}
