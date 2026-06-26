/**
 * Settle Processor — T+1 结算单生成（BullMQ WorkerHost）
 *
 * 决策依据：
 *   - W2-M-MANIFEST-W3.md §6：W3 末接入 BullMQ 定时任务跑 settlementService.runSettlement
 *   - 决策 2026-06-24：T+1 频率（02:00 Asia/Dili），接口预留配置项支持周/月结
 *
 * 任务名：
 *   - 'run-settlement'：日终结算，遍历所有 ACTIVE 商家 + 所有骑手，逐个生成结算单
 *     幂等：SettlementService.runSettlement 内部已做 (periodDate, subjectType, subjectId) 唯一性检查
 *     容错：单个 subject 失败不影响其他 subject，全部错误收集后整体返回
 *
 * 数据源：
 *   - MERCHANT 主体：db.shop.findMany({ status: 'ACTIVE' })（MVP 仅 1 条，但保留遍历能力）
 *   - RIDER 主体：db.riderProfile.findMany()（无 ACTIVE/INACTIVE 区分，全枚举）
 *   - 切真订单数据：settle.module.ts 改 SETTLE_ORDER_AGGREGATOR 的 useClass（C 流程完成后）
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { db } from '../../shared/db';
import { logger } from '../../shared/logger/logger';
import { getYesterdayInTz } from '../../shared/datetime';
import { SETTLE_QUEUE } from '../../shared/queue';
import { SettlementService } from './settlement.service';

export interface RunSettlementJobData {
  /** ISO date YYYY-MM-DD，缺省由 service 内部取昨天 */
  periodDate?: string;
  /** 仅结算指定 subject（手动触发用）；缺省=全量 */
  subjectType?: 'MERCHANT' | 'RIDER';
  subjectId?: string;
}

export interface RunSettlementJobResult {
  periodDate: string;
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ subjectType: string; subjectId: string; error: string }>;
}

@Processor(SETTLE_QUEUE, { concurrency: 1 })
export class SettleProcessor extends WorkerHost {
  constructor(private readonly settlementService: SettlementService) {
    super();
  }

  async process(job: Job<RunSettlementJobData, RunSettlementJobResult>): Promise<RunSettlementJobResult> {
    if (job.name === 'run-settlement') {
      return this.handleRunSettlement(job.data ?? {});
    }
    logger.warn({ msg: 'settle_unknown_job', jobName: job.name });
    return { periodDate: '', total: 0, succeeded: 0, failed: 0, errors: [] };
  }

  /**
   * 遍历所有 ACTIVE 商家 + 所有骑手，逐个调 runSettlement
   *
   * 单 subject 出错不中断整体（仍继续下一个），最后返回汇总结果
   */
  async handleRunSettlement(data: RunSettlementJobData): Promise<RunSettlementJobResult> {
    const periodDate = data.periodDate ?? this.getYesterday();
    const errors: RunSettlementJobResult['errors'] = [];
    let succeeded = 0;

    // 构建待结算主体列表
    const subjects: Array<{ subjectType: 'MERCHANT' | 'RIDER'; subjectId: string }> = [];

    if (data.subjectType && data.subjectId) {
      // 手动触发单个
      subjects.push({ subjectType: data.subjectType, subjectId: data.subjectId });
    } else if (data.subjectType === 'MERCHANT') {
      const shops = await db.shop.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
      shops.forEach((s) => subjects.push({ subjectType: 'MERCHANT', subjectId: s.id }));
    } else if (data.subjectType === 'RIDER') {
      const riders = await db.riderProfile.findMany({ select: { id: true } });
      riders.forEach((r) => subjects.push({ subjectType: 'RIDER', subjectId: r.id }));
    } else {
      // 全量
      const [shops, riders] = await Promise.all([
        db.shop.findMany({ where: { status: 'ACTIVE' }, select: { id: true } }),
        db.riderProfile.findMany({ select: { id: true } }),
      ]);
      shops.forEach((s) => subjects.push({ subjectType: 'MERCHANT', subjectId: s.id }));
      riders.forEach((r) => subjects.push({ subjectType: 'RIDER', subjectId: r.id }));
    }

    logger.info({
      msg: 'settle_run_start',
      periodDate,
      subjectCount: subjects.length,
    });

    for (const subject of subjects) {
      try {
        await this.settlementService.runSettlement({
          periodDate,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
        });
        succeeded += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          error: message,
        });
        logger.error({
          msg: 'settle_run_subject_failed',
          periodDate,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          error: message,
        });
      }
    }

    const result: RunSettlementJobResult = {
      periodDate,
      total: subjects.length,
      succeeded,
      failed: errors.length,
      errors,
    };

    logger.info({
      msg: 'settle_run_done',
      periodDate,
      total: result.total,
      succeeded: result.succeeded,
      failed: result.failed,
    });

    return result;
  }

  private getYesterday(): string {
    return getYesterdayInTz();
  }
}
