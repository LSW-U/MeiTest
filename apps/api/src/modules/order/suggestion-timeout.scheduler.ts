/**
 * Suggestion Timeout Scheduler — 替换建议超时扫描注册（BullMQ repeatable job）
 *
 * 替换品批1（2026-10-29 D7）：照 coupon-expire.scheduler 模式
 *   - onModuleInit 幂等注册 repeatable job（BullMQ 按 repeat pattern + key 去重）
 *   - 每 5min 扫 PENDING 超时（oos.suggestion_timeout_hours 默认 24h）→ 自动 DECLINED
 *   - repeat job 禁 jobId（settle.scheduler 审查同款）
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { SUGGESTION_TIMEOUT_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import type { SuggestionTimeoutJobData } from './suggestion-timeout.processor';

/** 重复任务去重 key */
const SUGGESTION_TIMEOUT_REPEAT_KEY = 'suggestion-timeout-every-5min';

/** 每 5 分钟跑一次（秒位避开整 0/30） */
const SUGGESTION_TIMEOUT_CRON_PATTERN = '*/5 * * * *';
const SUGGESTION_TIMEOUT_CRON_TZ = 'Asia/Dili';

/** 手动触发时用的 job name（与定时任务同 processor 处理） */
export const SUGGESTION_TIMEOUT_JOB_RUN = 'expire-stale-suggestions';

@Injectable()
export class SuggestionTimeoutScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(SUGGESTION_TIMEOUT_QUEUE) private readonly queue: Queue<SuggestionTimeoutJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    // repeat job 禁 jobId（审查报告先例）
    await this.queue.add(
      SUGGESTION_TIMEOUT_JOB_RUN,
      {} as SuggestionTimeoutJobData,
      {
        repeat: { pattern: SUGGESTION_TIMEOUT_CRON_PATTERN, tz: SUGGESTION_TIMEOUT_CRON_TZ, key: SUGGESTION_TIMEOUT_REPEAT_KEY },
      },
    );
    logger.info({
      msg: 'suggestion_timeout_scheduler_registered',
      pattern: SUGGESTION_TIMEOUT_CRON_PATTERN,
      tz: SUGGESTION_TIMEOUT_CRON_TZ,
    });
  }
}
