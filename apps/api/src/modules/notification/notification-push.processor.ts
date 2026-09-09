/**
 * Notification Push Processor — BullMQ 消费者（批A A5，2026-09-09）
 *
 * admin 批量通知异步推送：POST /admin/notifications 同步写 Batch 行 + 首块
 * Notification（真链路立即可见），剩余分块入 NOTIFICATION_QUEUE 由本 processor
 * 逐块消费（每块 100 用户，BullMQ 默认重试 3 次指数退避）。
 *
 * Job 数据：{ batchId, userIds: string[], title, content, type, data }
 * —— title/content/type/data 是批次快照（retry 重发同样从 Batch 行重建快照，
 * 避免编辑后批次内容漂移）。
 *
 * 每块完成：写 Notification（createMany）+ PUSH（sendPushToUser 公共 helper，
 * 查 ACTIVE tokens 逐 token 发）+ 批次计数增量回填
 * （deliveredCount=站内信落行数，failedCount=PUSH 失败用户数——审查 P3-1 统一口径）。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import { logger } from '../../shared/logger/logger';
import { sendPushToUser } from './send-push-to-user';

export const NOTIFICATION_PUSH_CHUNK_SIZE = 100;

/** 通知推送 job 数据 */
export interface NotificationPushJobData {
  batchId: string;
  userIds: string[];
  type: string;
  title: Record<string, string>;
  content: Record<string, string>;
  data?: Record<string, unknown>;
}

/** NotifyFactory 结构化类型（与 admin-notification.service 同款） */
interface NotifyFactoryLike {
  sendMulti: (
    request: {
      userId: string;
      type: string;
      title: Record<string, string>;
      body: Record<string, string>;
      data?: Record<string, unknown>;
    },
    channels: string[],
  ) => Promise<Record<string, { success: boolean; mockFlag: boolean; error?: string; messageId?: string }>>;
}

@Processor('notification', { concurrency: 3 })
export class NotificationPushProcessor extends WorkerHost {
  private readonly otpLogger = new Logger(NotificationPushProcessor.name);

  constructor(
    // tsx 无 decorator metadata：显式 token 注入（module 注册 'NotifyFactoryToken'）
    @Inject('NotifyFactoryToken')
    private readonly notifyFactory: NotifyFactoryLike | null,
  ) {
    super();
  }

  async process(job: Job<NotificationPushJobData>): Promise<void> {
    const { batchId, userIds, type, title, content, data } = job.data;
    this.otpLogger.log(
      `processing notification chunk: batchId=${batchId} users=${userIds.length} attempt=${job.attemptsMade + 1}`,
    );

    // 1. 站内信（真链路）：批量写 Notification
    const rows = userIds.map((userId) => ({
      userId,
      type: type as never,
      title: title as unknown as Prisma.InputJsonValue,
      content: content as unknown as Prisma.InputJsonValue,
      isRead: false,
      batchId,
      data: (data ?? null) as unknown as Prisma.InputJsonValue,
    }));
    const created = await db.notification.createMany({ data: rows });

    // 2. PUSH（审查 P2-2：走 sendPushToUser 公共 helper——先查 ACTIVE deviceToken
    //    逐 token 发，expo 模式群发不带 token 必失败 MISSING_DEVICE_TOKEN；
    //    PUSH 失败计数，不影响站内信已落）
    let pushFailed = 0;
    for (const userId of userIds) {
      const pushResult = await sendPushToUser({
        notifyFactory: this.notifyFactory,
        userId,
        type,
        title,
        content,
        data,
      });
      pushFailed += pushResult.pushFailed;
      if (pushResult.pushError) {
        logger.warn({
          msg: 'NOTIFICATION_PUSH_CHUNK_USER_FAILED',
          batchId,
          userId,
          error: pushResult.pushError,
        });
      }
    }

    // 3. 回填批次计数（增量 update，并发块安全——不同块写不同用户，计数用 increment）
    //    审查 P3-1：deliveredCount 统一口径 = 站内信落行数（createMany.count）
    const delivered = created.count;
    await db.notificationBatch.update({
      where: { id: batchId },
      data: {
        deliveredCount: { increment: delivered },
        failedCount: { increment: pushFailed },
      },
    });

    logger.info({
      msg: 'NOTIFICATION_CHUNK_PROCESSED',
      batchId,
      chunkSize: userIds.length,
      delivered,
      pushFailed,
    });
  }
}
