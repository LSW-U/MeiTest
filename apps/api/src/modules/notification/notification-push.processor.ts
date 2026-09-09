/**
 * Notification Push Processor — BullMQ 消费者（批A A5，2026-09-09；批N4 扩回执 sweep）
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
 *
 * 批N4（2026-09-10）：job name 'receipts-sweep' 分支 —— 推送完成 5min 后拉取
 * Expo getReceipts 回执校准：ok→delivered 差额 / DeviceNotRegistered→token INVALID
 * +failed / 其他 error→failed。幂等：job data 携 ticketIds 即已发送集合，
 * 校准用 increment 只增不降 + Redis 已处理标记防重复计数；stub/无凭证 no-op。
 */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import { logger } from '../../shared/logger/logger';
import { sendPushToUser } from './send-push-to-user';
import { getPushProvider } from '../../infrastructure';
import { fetchAllExpoReceipts } from './expo-receipts';
import { processReceipts } from './receipts-sweep.service';
import { enqueueReceiptsSweep } from './receipts-sweep.helper';

export const NOTIFICATION_PUSH_CHUNK_SIZE = 100;

/** 批N4：回执拉取延迟（推送完成后 5min——Expo 回执建议等待时长） */
export const NOTIFICATION_RECEIPTS_DELAY_MS = 5 * 60 * 1000;

/** 通知推送 job 数据 */
export interface NotificationPushJobData {
  batchId: string;
  userIds: string[];
  type: string;
  title: Record<string, string>;
  content: Record<string, string>;
  data?: Record<string, unknown>;
}

/** 批N4：回执拉取 job 数据（推送完成后聚合的 Expo ticket ids） */
export interface NotificationReceiptsJobData {
  batchId: string;
  ticketIds: string[];
}

/** 判别推送 job vs 回执 job（receipts-sweep 的 data 无 userIds 字段） */
function isReceiptsJob(data: unknown): data is NotificationReceiptsJobData {
  return typeof data === 'object' && data !== null && 'ticketIds' in data;
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
    // 批N4：回执 sweep 入队（module 注册 'NotificationQueueToken'；测试可传 null）
    @Inject('NotificationQueueToken')
    private readonly notificationQueue: {
      add: (
        name: string,
        data: NotificationReceiptsJobData,
        opts?: Record<string, unknown>,
      ) => Promise<unknown>;
    } | null,
  ) {
    super();
  }

  async process(job: Job<NotificationPushJobData | NotificationReceiptsJobData>): Promise<void> {
    // 批N4：回执拉取 job 分支（同一队列双 job name）
    if (isReceiptsJob(job.data)) {
      await this.processReceiptsSweep(job as Job<NotificationReceiptsJobData>);
      return;
    }
    await this.processPushChunk(job as Job<NotificationPushJobData>);
  }

  /**
   * 批N4：回执 sweep —— 拉取 getReceipts 并校准批次计数
   *
   * 前置守卫（幂等 no-op）：
   *   - PUSH_PROVIDER != 'expo'（stub 模式）：job 静默跳过（ticket 全是 mock，无回执可查）
   *   - ticketIds 空：no-op
   */
  private async processReceiptsSweep(job: Job<NotificationReceiptsJobData>): Promise<void> {
    const { batchId, ticketIds } = job.data;
    this.otpLogger.log(
      `processing receipts sweep: batchId=${batchId} tickets=${ticketIds.length} attempt=${job.attemptsMade + 1}`,
    );

    // stub 模式：job 直接跳过（幂等 no-op，不重试不报错）
    if (getPushProvider() !== 'expo') {
      logger.info({
        msg: 'RECEIPTS_SWEEP_SKIPPED_STUB',
        batchId,
        tickets: ticketIds.length,
      });
      return;
    }
    if (ticketIds.length === 0) {
      return;
    }

    // 拉取回执（网络/HTTP 错误抛出 → BullMQ 重试）
    const receipts = await fetchAllExpoReceipts(ticketIds);

    // 处置 + 批次聚合（幂等标记/只增不降在 receipts-sweep.service 内）
    const summary = await processReceipts(batchId, ticketIds, receipts);

    logger.info({
      msg: 'RECEIPTS_SWEEP_PROCESSED',
      batchId,
      fetched: receipts.size,
      ...summary,
    });
  }

  /** 推送分块消费（批A A5 原逻辑不动） */
  private async processPushChunk(job: Job<NotificationPushJobData>): Promise<void> {
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
    // 批N4：收集真 Expo ticket（stub/mock 为 null 不收集），块完成入延迟回执 job
    const pushTicketIds: string[] = [];
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
      if (pushResult.pushTicketId) {
        pushTicketIds.push(pushResult.pushTicketId);
      }
    }

    // 批N4：本块推送完成 → 入 5min 延迟回执 job（helper 内部容忍入队失败/空队列）
    if (pushTicketIds.length > 0) {
      await enqueueReceiptsSweep(this.notificationQueue, batchId, pushTicketIds);
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
