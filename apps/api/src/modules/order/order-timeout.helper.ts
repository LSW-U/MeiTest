/**
 * Order Timeout Queue Helper — 入队/取消超时 job
 *
 * 拆分原因：
 *   - OrderService 直接注入 Queue（避免与 Processor 循环依赖）
 *   - OrderTimeoutProcessor 处理消费侧逻辑
 *
 * 用法（OrderService）：
 *   constructor(@InjectQueue(ORDER_TIMEOUT_QUEUE) private timeoutQueue: Queue<OrderTimeoutJobData>) {}
 *   await enqueueOrderTimeout(this.timeoutQueue, orderId, status);
 */
import type { Queue } from 'bullmq';
import { ORDER_TIMEOUT_MS, type OrderTimeoutJobData } from './order-timeout.processor';
import { logger } from '../../shared/logger/logger';

export { ORDER_TIMEOUT_MS, type OrderTimeoutJobData };

/** 入队超时 job（idempotent，jobId 去重） */
export async function enqueueOrderTimeout(
  queue: Queue<OrderTimeoutJobData>,
  orderId: string,
  enqueuedStatus: string,
): Promise<void> {
  try {
    await queue.add(
      'cancel-pending',
      { orderId, enqueuedStatus },
      {
        jobId: `order-timeout:${orderId}`,
        delay: ORDER_TIMEOUT_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    logger.info({
      msg: 'ORDER_TIMEOUT_ENQUEUED',
      orderId,
      enqueuedStatus,
      delayMs: ORDER_TIMEOUT_MS,
    });
  } catch (e) {
    // Redis 不可用时不下单失败（业务降级：订单仍创建，超时取消走兜底 cron）
    logger.error({
      msg: 'ORDER_TIMEOUT_ENQUEUE_FAILED',
      orderId,
      error: (e as Error).message,
    });
  }
}

/** 取消超时 job（订单推进到 CONFIRMED 后调） */
export async function cancelOrderTimeout(
  queue: Queue<OrderTimeoutJobData>,
  orderId: string,
): Promise<void> {
  try {
    const job = await queue.getJob(`order-timeout:${orderId}`);
    if (job) {
      await job.remove();
      logger.info({
        msg: 'ORDER_TIMEOUT_CANCELLED',
        orderId,
      });
    }
  } catch (e) {
    logger.error({
      msg: 'ORDER_TIMEOUT_CANCEL_FAILED',
      orderId,
      error: (e as Error).message,
    });
  }
}
