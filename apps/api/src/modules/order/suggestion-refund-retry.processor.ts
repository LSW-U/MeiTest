/**
 * Suggestion Refund Retry Processor — 超时退款失败重试消费端（批3 P1-E，20261122）
 *
 * 链路：decideSuggestionTimeoutRefund 引擎异常（P2-1：triggered=false 是正常终态不入队）→
 *   enqueueSuggestionRefundRetry 入队 → 本 processor 重跑 triggerDeclinedRefund；
 *   BullMQ attempts:3 自动重试，3 次全败（job.attemptsDone >= attempts）→
 *   死信结构化日志 + Sentry captureException 告警（无 DLQ 表，零 migration）。
 *
 * 通知防重（批3 硬要求）：重试成功路径的通知 dedup 对齐 notifyOutOfStock 先例——
 *   以 Notification 行落库为成功探针（data.orderId 精确匹配），已存在则跳过发送；
 *   退款单次性由引擎内部守卫保证（合并账 inFlight 追加 / D14 已完成不叠加 / 防超额）。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SUGGESTION_REFUND_RETRY_QUEUE } from '../../shared/queue';
import { logger } from '../../shared/logger/logger';
import { captureException } from '../../shared/monitoring/sentry';
import { OrderService, type SuggestionRefundOutcome } from './order.service';

export interface SuggestionRefundRetryJobData {
  orderId: string;
  itemId: string;
}

/** 常量镜像 helper（helper 引 type 时避免 helper↔processor 循环 import 的值依赖） */
const MAX_ATTEMPTS = 3;

@Processor(SUGGESTION_REFUND_RETRY_QUEUE, { concurrency: 1 })
export class SuggestionRefundRetryProcessor extends WorkerHost {
  constructor(
    // DI 显式 token（tsx 无 decorator metadata；order.module 注册 useExisting）
    @Optional() @Inject('SUGGESTION_REFUND_RETRY_ORDER_SERVICE')
    private readonly orderService?: OrderService | null,
  ) {
    super();
  }

  async process(job: Job<SuggestionRefundRetryJobData>): Promise<void> {
    if (job.name !== 'refund-declined') {
      logger.warn({ msg: 'suggestion_refund_retry_unknown_job', jobName: job.name });
      return;
    }
    const { orderId, itemId } = job.data;
    logger.info({
      msg: 'suggestion_refund_retry_processing',
      orderId,
      itemId,
      attempt: job.attemptsMade + 1,
    });

    if (!this.orderService) {
      logger.warn({ msg: 'SUGGESTION_REFUND_RETRY_NO_SERVICE', orderId, itemId });
      return;
    }

    // 重跑退款（outOfStock 未清才真正退；已退/未登记 → skipped，通知防重探针兜底）
    const outcome: SuggestionRefundOutcome = await this.orderService.retrySuggestionTimeoutRefund(orderId, itemId);

    // 失败 → 非末次抛错交 BullMQ backoff 重试（attempts:3 才真实计数）；
    // 末次 → 死信痕迹后正常 resolve（不抛，防 BullMQ 再排）
    if (outcome.status === 'failed') {
      const isLastAttempt = job.attemptsMade + 1 >= MAX_ATTEMPTS;
      if (!isLastAttempt) {
        throw new Error(
          `SUGGESTION_REFUND_RETRY_FAILED(orderId=${orderId}, itemId=${itemId}): ${outcome.error ?? 'refund not triggered'}`,
        );
      }
      const dl = {
        msg: 'SUGGESTION_REFUND_RETRY_DEAD_LETTER',
        orderId,
        itemId,
        attempts: MAX_ATTEMPTS,
        error: outcome.error ?? 'refund not triggered',
        hint: 'refund requires manual intervention (admin OOS 登记链可补)',
      };
      logger.error(dl);
      captureException(new Error(`SUGGESTION_REFUND_RETRY_DEAD_LETTER: orderId=${orderId} itemId=${itemId}`));
    }
  }
}
