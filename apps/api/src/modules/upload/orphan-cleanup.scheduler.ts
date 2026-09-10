/**
 * Orphan Cleanup Scheduler — 每日定时任务注册（upload 模块批C U4P，2026-09-10）
 *
 * 设计要点（与 settle.scheduler.ts 同款范式）：
 *   - onModuleInit 幂等注册 repeatable job（BullMQ 按 repeat pattern + key 去重）
 *   - 禁止同时指定 jobId（repeat.key 已是去重 key，BullMQ 文档明确）
 *   - 时区 Asia/Dili（UTC+9），每日 04:17 低峰错峰
 *   - 定时任务默认 DRY-RUN（只统计记日志不删）；真删开关：env
 *     ORPHAN_CLEANUP_EXECUTE=true 或手动 job data.execute=true
 */
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { logger } from '../../shared/logger/logger';
import type { OrphanCleanupJobData } from './orphan-cleanup.processor';
import {
  ORPHAN_CLEANUP_CRON_PATTERN,
  ORPHAN_CLEANUP_CRON_TZ,
  ORPHAN_CLEANUP_JOB_NAME,
  ORPHAN_CLEANUP_REPEAT_KEY,
  isOrphanCleanupExecuteEnabled,
} from './orphan-cleanup.config';

@Injectable()
export class OrphanCleanupScheduler implements OnModuleInit {
  constructor(
    // tsx 无 decorator metadata：显式 token 注入（upload.module 注册 'OrphanCleanupQueueToken'）
    @Inject('OrphanCleanupQueueToken')
    private readonly queue: Queue<OrphanCleanupJobData> | null,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) return; // 测试场景可传 null
    // 定时任务执行模式：env 开关（默认 dry-run）决定定时 job 是否真删
    const execute = isOrphanCleanupExecuteEnabled();
    await this.queue.add(
      ORPHAN_CLEANUP_JOB_NAME,
      { execute } as OrphanCleanupJobData,
      {
        repeat: {
          pattern: ORPHAN_CLEANUP_CRON_PATTERN,
          tz: ORPHAN_CLEANUP_CRON_TZ,
          key: ORPHAN_CLEANUP_REPEAT_KEY,
        },
      },
    );
    logger.info({
      msg: 'orphan_cleanup_scheduler_registered',
      pattern: ORPHAN_CLEANUP_CRON_PATTERN,
      tz: ORPHAN_CLEANUP_CRON_TZ,
      execute,
    });
  }
}
