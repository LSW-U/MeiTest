/**
 * Suggestion Refund Retry Helper — 超时退款失败重试入队（批3 P1-E，20261122）
 *
 * 拆分原因（照抄 order-timeout.helper.ts 先例）：
 *   - OrderService 直接注入 Queue（避免与 Processor 循环依赖）
 *   - SuggestionRefundRetryProcessor 处理消费侧逻辑
 *
 * retry 参数照抄 order-timeout.helper.ts:28-34 全仓唯一先例：
 *   attempts:3 + backoff exponential delay 5_000
 */
import type { Queue } from 'bullmq';
import { logger } from '../../shared/logger/logger';
import type { SuggestionRefundRetryJobData } from './suggestion-refund-retry.processor';

/** 入队退款重试 job（jobId 去重：同单同项等待中的重试 job 不会重复入队） */
export async function enqueueSuggestionRefundRetry(
  queue: Queue<SuggestionRefundRetryJobData> | null | undefined,
  orderId: string,
  itemId: string,
): Promise<void> {
  // 队列未注入（单测直 new / 队列模块缺失）→ 告警不抛（重试属补偿链，不阻断主流程）
  if (!queue) {
    logger.warn({
      msg: 'SUGGESTION_REFUND_RETRY_QUEUE_MISSING',
      orderId,
      itemId,
    });
    return;
  }
  try {
    await queue.add(
      'refund-declined',
      { orderId, itemId },
      {
        jobId: `suggestion-refund-retry:${orderId}:${itemId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    logger.info({
      msg: 'SUGGESTION_REFUND_RETRY_ENQUEUED',
      orderId,
      itemId,
    });
  } catch (e) {
    // Redis 不可用：重试入队失败仅告警（退款可人工补——单次补偿纪律）
    logger.error({
      msg: 'SUGGESTION_REFUND_RETRY_ENQUEUE_FAILED',
      orderId,
      itemId,
      error: (e as Error).message,
    });
  }
}
