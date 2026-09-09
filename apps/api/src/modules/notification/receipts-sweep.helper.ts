/**
 * Receipts Sweep Queue Helper — 回执拉取延迟 job 入队（批N4，2026-09-10）
 *
 * 拆分原因（与 order-timeout.helper 同款）：
 *   - AdminNotificationService / NotificationPushProcessor 直接注入 Queue
 *     （避免与 Processor 循环依赖）
 *   - NotificationPushProcessor 处理消费侧（job name 'receipts-sweep' 分支）
 *
 * 时序：推送完成后入队 delay 5min job —— Expo push ticket 的回执在发送后
 * 数分钟才可稳定查询（官方建议），提前查会拿到不完整结果。
 *
 * 入队失败容忍：Redis 不可用/队列缺失不炸推送主链路（回执校准是增强数据面，
 * 丢一次 sweep 只影响该批次的 failed/delivered 校准与脏 token 清理时效）。
 */
import { logger } from '../../shared/logger/logger';
import type { NotificationReceiptsJobData } from './notification-push.processor';
import { NOTIFICATION_RECEIPTS_DELAY_MS } from './notification-push.processor';

export { NOTIFICATION_RECEIPTS_DELAY_MS };

/** Queue 最小结构化类型（与 admin-notification.service NotificationQueueLike 同构） */
interface NotificationQueueLike {
  add: (
    name: string,
    data: NotificationReceiptsJobData,
    opts?: Record<string, unknown>,
  ) => Promise<unknown>;
}

/**
 * 入队回执拉取 job（同一 NOTIFICATION_QUEUE，job name 'receipts-sweep'）
 *
 * - delay 5min（NOTIFICATION_RECEIPTS_DELAY_MS）
 * - attempts 3 + 指数退避（与 push job 一致）
 * - queue 为 null（测试环境无队列装配）→ 静默跳过（no-op，不抛）
 */
export async function enqueueReceiptsSweep(
  queue: NotificationQueueLike | null,
  batchId: string,
  ticketIds: string[],
): Promise<void> {
  if (!queue || ticketIds.length === 0) {
    return;
  }
  try {
    await queue.add(
      'receipts-sweep',
      { batchId, ticketIds } satisfies NotificationReceiptsJobData,
      {
        delay: NOTIFICATION_RECEIPTS_DELAY_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    logger.info({
      msg: 'RECEIPTS_SWEEP_ENQUEUED',
      batchId,
      tickets: ticketIds.length,
      delayMs: NOTIFICATION_RECEIPTS_DELAY_MS,
    });
  } catch (e) {
    // 入队失败不炸推送主链路（站内信已落、推送已发；只损失回执校准）
    logger.error({
      msg: 'RECEIPTS_SWEEP_ENQUEUE_FAILED',
      batchId,
      tickets: ticketIds.length,
      error: (e as Error).message,
    });
  }
}
