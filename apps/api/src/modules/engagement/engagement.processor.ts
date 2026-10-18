/**
 * Engagement Processor — BullMQ 定时任务消费者（批4 触达自动化，2026-10-18）
 *
 * job name：
 *   'run-all'  定时扫描（每 30min）：顺序跑 C1/C2/C3/C6/B2/B3 六流，逐流隔离失败
 *   'run-flow' 手动单流触发（运维/debug）：data.flow 指定
 *
 * 范式照抄 coupon-expire.processor.ts：WorkerHost + 单并发（幂等由
 * OutreachTrigger 唯一约束保证，重试安全）。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ENGAGEMENT_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import { EngagementService } from './engagement.service';
import { isEngagementFlow } from './engagement.templates';

export interface EngagementJobData {
  /** 'run-flow' 用：目标流（C1/C2/C3/C6/B2/B3/C4/C7/C8/B4） */
  flow?: string;
}

export interface EngagementJobResult {
  flows: string[];
  sent: number;
  skipped: number;
}

@Processor(ENGAGEMENT_QUEUE, { concurrency: 1 })
export class EngagementProcessor extends WorkerHost {
  constructor(private readonly engagement: EngagementService) {
    super();
  }

  async process(job: Job<EngagementJobData, EngagementJobResult>): Promise<EngagementJobResult> {
    if (job.name === 'run-all') {
      const results = await this.engagement.runAllFlows();
      return this.summarize(results.map((r) => r.flow), results);
    }
    if (job.name === 'run-flow') {
      const flow = job.data?.flow ?? '';
      if (!isEngagementFlow(flow)) {
        logger.warn({ msg: 'ENGAGEMENT_UNKNOWN_FLOW', flow });
        return { flows: [], sent: 0, skipped: 0 };
      }
      const runners: Record<string, () => Promise<{ sent: number; skipped: number }>> = {
        C1: () => this.engagement.runRetentionFlow(),
        C2: () => this.engagement.runFirstPurchaseFlow(),
        C3: () => this.engagement.runThanksFlow(),
        C6: () => this.engagement.runBirthdayFlow(),
        B2: () => this.engagement.runReplenishFlow(),
        B3: () => this.engagement.runCartRecallFlow(),
        // 批5 四流
        C4: () => this.engagement.runAutoReplenishFlow(),
        C7: () => this.engagement.runPriceAlertFlow(),
        C8: () => this.engagement.runRestockAlertFlow(),
        B4: () => this.engagement.runViewNudgeFlow(),
      };
      const r = await runners[flow]();
      return this.summarize([flow], [r as { sent: number; skipped: number }]);
    }
    logger.warn({ msg: 'ENGAGEMENT_UNKNOWN_JOB', jobName: job.name });
    return { flows: [], sent: 0, skipped: 0 };
  }

  private summarize(
    flows: string[],
    results: Array<{ sent: number; skipped: number }>,
  ): EngagementJobResult {
    const sent = results.reduce((s, r) => s + r.sent, 0);
    const skipped = results.reduce((s, r) => s + r.skipped, 0);
    logger.info({ msg: 'ENGAGEMENT_JOB_DONE', flows, sent, skipped });
    return { flows, sent, skipped };
  }
}
