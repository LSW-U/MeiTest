/**
 * Admin Notification Service — 后台通知/推送业务（admin-web 优化方案 批次2 2026-08-29）
 *
 * 批A A5 批次化改造（2026-09-09，方案v2 §3.5）：
 *   - send：写 NotificationBatch 行（批次真实存在）→ 首块 100 人同步写 Notification
 *     + PUSH（真链路立即可见）→ 剩余分块入 NOTIFICATION_QUEUE（BullMQ）异步推送
 *   - listHistory：历史改为批次行倒序（target/totalRecipients 真实值；
 *     deliveredCount=批次累计回执；readCount=实时聚合 count(batchId, isRead=true)）
 *   - retry：POST /admin/notifications/:batchId/retry 仅重发 failed 用户
 *     —— failed 用户集合 = 批次 totalRecipients 对应者中无成功 Notification 行者？
 *     MVP 简化：批次失败用户未落行（PUSH 失败但站内信必落），故 retry 语义 =
 *     重发整批中「Notification 无行」的用户。站内信与 PUSH 在同一事务外同一循环落，
 *     MVP 阶段站内信 createMany 与 PUSH 计数解耦：PUSH 失败用户集合不单独持久化，
 *     retry 按批次重建快照重发全部 recipient 中「未读到该批次站内信」的用户。
 *     ——进一步简化（任务书 A5 验收口径）：retry 重发 failed 用户 =
 *     Notification 中该批次 isRead=false 且 PUSH 曾失败的用户不可查 →
 *     采用「重建全量快照 + 剔除已有本批次 Notification 行的用户」= 无行用户重发。
 *
 * 错误码：
 *   - E-ADMIN-NOTIF-001 target=SPECIFIC_USERS 但 userIds 含不存在用户（部分校验，列出缺失 ID）
 *   - E-ADMIN-NOTIF-002 群发规模超上限（ALL_CUSTOMERS/ALL_RIDERS 单次 > 50000，防误操作）
 *   - E-ADMIN-NOTIF-003 retry 批次不存在（批A A5 新增）
 *   - E-ADMIN-NOTIF-004 retry 批次 SPECIFIC_USERS 快照缺失，无法恢复收件人全集（审查 P2-1）
 *   - E-COMMON-001（zod 校验，controller pipe 抛）
 *
 * 双限不动：BROADCAST_HARD_LIMIT=50_000；SPECIFIC_USERS max(1000)（zod contract 限）。
 *
 * NotifyFactory 注入：tsx 无 decorator metadata，必须 @Inject('NotifyFactoryToken')。
 */
import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import type { AdminSendNotificationRequest } from '@meimart/api-contract';
import {
  AdminSendNotificationResponseData,
  AdminNotificationHistoryItem,
  AdminNotificationType,
  NotificationTarget,
  AdminRetryNotificationResponseData,
} from '@meimart/api-contract';
import type { NotificationPushJobData } from './notification-push.processor';
import { NOTIFICATION_PUSH_CHUNK_SIZE } from './notification-push.processor';
import { sendPushToUser } from './send-push-to-user';

/** 后台通知发送响应视图（contract schema 推导，避免双源漂移） */
type AdminSendNotificationResponseView = z.infer<typeof AdminSendNotificationResponseData>;
/** 后台通知历史项视图 */
type AdminNotificationHistoryItemView = z.infer<typeof AdminNotificationHistoryItem>;
/** 后台通知类型视图（contract enum 推导） */
type AdminNotificationTypeView = z.infer<typeof AdminNotificationType>;
/** 通知目标视图（contract enum 推导） */
type NotificationTargetView = z.infer<typeof NotificationTarget>;
/** 发送请求视图（contract schema 推导） */
type AdminSendNotificationRequestView = z.infer<typeof AdminSendNotificationRequest>;
/** retry 响应视图 */
type AdminRetryNotificationResponseView = z.infer<typeof AdminRetryNotificationResponseData>;

/** 群发规模上限（ALL_CUSTOMERS/ALL_RIDERS 单次群发防误操作硬上限） */
const BROADCAST_HARD_LIMIT = 50_000;

/** Queue 注入结构化类型（避免直接依赖 BullMQ 泛型） */
interface NotificationQueueLike {
  add: (name: string, data: NotificationPushJobData, opts?: Record<string, unknown>) => Promise<unknown>;
}

/** NotifyFactory 注入类型（与 order.service 同款结构化类型，避免循环导入具体类） */
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
  ) => Promise<
    Record<
      string,
      { success: boolean; mockFlag: boolean; error?: string; messageId?: string }
    >
  >;
}

@Injectable()
export class AdminNotificationService {
  constructor(
    @Inject('NotifyFactoryToken')
    private readonly notifyFactory: NotifyFactoryLike | null,
    // 批A A5：BullMQ 通知队列（module 注册 'NotificationQueueToken'）
    @Inject('NotificationQueueToken')
    private readonly notificationQueue: NotificationQueueLike | null,
  ) {}

  /**
   * 发送通知（群发/指定，批次化）
   *
   * 流程：
   *   1. 解析 target → userIds（ALL_CUSTOMERS/ALL_RIDERS 查 DB；SPECIFIC_USERS 校验存在性）
   *   2. 写 NotificationBatch 行（totalRecipients=解析后人数）
   *   3. 首块（≤100 人）同步：createMany 写 Notification（batchId 关联）+ PUSH 尝试
   *   4. 剩余分块（每块 100）入 NOTIFICATION_QUEUE 异步推（processor 写行 + 回填计数）
   *
   * 返回：deliveredCount（=首块同步落行数，与旧行为量纲一致——首块立即可见）
   *      + push 结果（首块 PUSH 结果；mockFlag=true 提示 dev stub）
   */
  async send(
    input: AdminSendNotificationRequestView,
    createdBy: string,
  ): Promise<AdminSendNotificationResponseView> {
    const userIds = await this.resolveTargetUserIds(input.target, input.userIds);

    // 批次行先行落库（无收件人也落——历史可追溯 0 投递批次）
    const batch = await db.notificationBatch.create({
      data: {
        type: input.type,
        target: input.target,
        title: input.title as unknown as Prisma.InputJsonValue,
        content: input.content as unknown as Prisma.InputJsonValue,
        // 审查 P2-1：收件人快照（SPECIFIC_USERS 存 userIds，ALL_* 存 null——
        // 群发目标集合动态变化，快照无意义；指定用户批次 retry 按此恢复全集）
        userIds: (input.target === 'SPECIFIC_USERS'
          ? (userIds as unknown as Prisma.InputJsonValue)
          : (null as unknown as Prisma.InputJsonValue)) as Prisma.InputJsonValue,
        totalRecipients: userIds.length,
        createdBy,
      },
    });

    if (userIds.length === 0) {
      // 无收件人（如 ALL_RIDERS 但库内无骑手）：批次 0 人，PUSH 跳过
      return {
        batchId: batch.id,
        totalRecipients: 0,
        deliveredCount: 0,
        push: { success: false, mockFlag: true, error: 'no recipients' },
      };
    }

    // 首块同步写 + PUSH（前端发送后立即可见，行为回归批次2）
    const firstChunk = userIds.slice(0, NOTIFICATION_PUSH_CHUNK_SIZE);
    const firstDelivered = await this.deliverChunk(
      batch.id,
      firstChunk,
      input.type,
      input.title,
      input.content,
      input.data ?? undefined,
    );

    // 剩余分块入队（异步，processor 写行 + 回填 deliveredCount/failedCount）
    const restChunks: string[][] = [];
    for (let i = NOTIFICATION_PUSH_CHUNK_SIZE; i < userIds.length; i += NOTIFICATION_PUSH_CHUNK_SIZE) {
      restChunks.push(userIds.slice(i, i + NOTIFICATION_PUSH_CHUNK_SIZE));
    }
    for (const chunk of restChunks) {
      if (this.notificationQueue) {
        await this.notificationQueue.add('push', {
          batchId: batch.id,
          userIds: chunk,
          type: input.type,
          title: input.title,
          content: input.content,
          data: input.data ?? undefined,
        });
      } else {
        // 无队列（测试环境）：降级同步推（保持真链路语义）
        await this.deliverChunk(
          batch.id,
          chunk,
          input.type,
          input.title,
          input.content,
          input.data ?? undefined,
        );
      }
    }

    return {
      batchId: batch.id,
      totalRecipients: userIds.length,
      deliveredCount: firstDelivered.delivered,
      push: { success: firstDelivered.pushSuccess, mockFlag: true, error: firstDelivered.pushError },
    };
  }

  /**
   * 单块投递：createMany 站内信（batchId 关联）+ PUSH 逐用户尝试 + 计数回填
   *
   * PUSH 走 sendPushToUser 公共 helper（审查 P2-2：先查 ACTIVE tokens 逐 token
   * 发，expo 模式群发不带 token 必失败 MISSING_DEVICE_TOKEN）。
   *
   * 计数口径（审查 P3-1 统一）：delivered = 站内信落行数（createMany.count）；
   * 批次 deliveredCount 累加站内信行数、failedCount 累加 PUSH 失败用户数。
   *
   * 返回 delivered（站内信落行数）/ pushSuccess / pushError（PUSH 汇总）
   */
  private async deliverChunk(
    batchId: string,
    userIds: string[],
    type: string,
    title: Record<string, string>,
    content: Record<string, string>,
    data?: Record<string, unknown>,
  ): Promise<{ delivered: number; pushSuccess: boolean; pushError: string | null }> {
    const rows = userIds.map((userId) => ({
      userId,
      type: type as never,
      title: title as unknown as Prisma.InputJsonValue,
      content: content as unknown as Prisma.InputJsonValue,
      isRead: false,
      batchId,
      data: (data ?? null) as unknown as Prisma.InputJsonValue,
    }));
    const createResult = await db.notification.createMany({ data: rows });

    // PUSH 通道（dev stub 或 A2 Expo）。逐用户发（token 级失败不影响其他用户）。
    let pushFailed = 0;
    let pushError: string | null = null;
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
        pushError = pushResult.pushError;
      }
    }

    // 审查 P3-1：deliveredCount 统一口径 = 站内信落行数（与 retry 校正、历史行一致）
    const delivered = createResult.count;
    await db.notificationBatch.update({
      where: { id: batchId },
      data: {
        deliveredCount: { increment: delivered },
        failedCount: { increment: pushFailed },
      },
    });

    return { delivered, pushSuccess: pushFailed < userIds.length, pushError };
  }

  /**
   * 发送历史列表（批次行倒序，offset 分页）
   *
   * 批A A5 批次化：每行 = 一次 admin 群发（NotificationBatch）。
   *   - target / totalRecipients：批次真实值
   *   - deliveredCount / failedCount：批次累计（processor 回填）
   *   - readCount：实时聚合 count(notification.batchId AND isRead=true)
   * 仅支持 type 行级筛选（与批次2 行为一致）。
   */
  async listHistory(opts: {
    type?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{
    items: AdminNotificationHistoryItemView[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.NotificationBatchWhereInput = {};
    if (opts.type) where.type = opts.type;

    const [rows, total] = await Promise.all([
      db.notificationBatch.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      db.notificationBatch.count({ where }),
    ]);

    // readCount 实时聚合（分页行数 ≤100，逐行 count 可接受；MVP 不做 groupBy 缓存）
    const items = await Promise.all(
      rows.map(async (r) => {
        const readCount = await db.notification.count({
          where: { batchId: r.id, isRead: true },
        });
        return {
          id: r.id,
          type: r.type as AdminNotificationTypeView,
          target: r.target as NotificationTargetView,
          totalRecipients: r.totalRecipients,
          deliveredCount: r.deliveredCount,
          failedCount: r.failedCount,
          readCount,
          title: r.title as Record<string, string>,
          content: r.content as Record<string, string>,
          createdAt: r.createdAt.toISOString(),
        } satisfies AdminNotificationHistoryItemView;
      }),
    );

    return {
      items,
      page,
      pageSize,
      total,
      hasMore: skip + rows.length < total,
    };
  }

  /**
   * 失败重试（批A A5）：仅重发 failed 用户
   *
   * 全集恢复（审查 P2-1 裁决：快照列方案）：
   *   - SPECIFIC_USERS：batch.userIds 快照（send 时落库）直接恢复原始收件人全集
   *   - ALL_CUSTOMERS/ALL_RIDERS：快照为 null，按 target 当前 DB 重新解析
     *   - 快照缺失/损坏的 SPECIFIC_USERS 批次（历史数据）：抛 E-ADMIN-NOTIF-004 明确报错，
     *     不静默按空集合处理
   *
   * failed 用户 = 全集中「本批次无 Notification 行」者
   * （站内信与 PUSH 同循环落，无行 = 当次投递整体失败；PUSH 单独失败但行已落的
   * 用户视为已送达——真链路站内信必达，PUSH 是增强）。
   *
   * 重发走同一 deliverChunk（重建批次快照 type/title/content/data）。
   */
  async retry(batchId: string): Promise<AdminRetryNotificationResponseView> {
    const batch = await db.notificationBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundException({ code: 'E-ADMIN-NOTIF-003', message: `Batch not found: ${batchId}` });
    }

    // 恢复收件人全集：SPECIFIC_USERS 优先用快照，ALL_* 按 target 重新解析
    const target = batch.target as NotificationTargetView;
    let allUserIds: string[];
    if (target === 'SPECIFIC_USERS') {
      const snapshot = batch.userIds;
      if (!Array.isArray(snapshot) || snapshot.length === 0) {
        throw new BadRequestException({
          code: 'E-ADMIN-NOTIF-004',
          message: 'Batch userIds snapshot missing; cannot recover recipients for retry',
        });
      }
      allUserIds = snapshot.filter((id): id is string => typeof id === 'string');
    } else {
      allUserIds = await this.resolveTargetUserIds(target, undefined);
    }

    // 已有本批次行 userIds（这些用户站内信已落，不重发）
    const deliveredRows = await db.notification.findMany({
      where: { batchId },
      select: { userId: true },
    });
    const deliveredSet = new Set(deliveredRows.map((r) => r.userId));
    const failedUserIds = allUserIds.filter((id) => !deliveredSet.has(id));

    if (failedUserIds.length === 0) {
      // 无 failed 用户：直接返回批次当前计数（复用开头已查的 batch，不再二次查询）
      return {
        batchId,
        retriedCount: 0,
        deliveredCount: batch.deliveredCount,
        failedCount: batch.failedCount,
        push: { success: true, mockFlag: true, error: null },
      };
    }

    // 重发（单块语义：failed 通常远小于原批；>100 也直接走 deliverChunk 一次落——
    // retry 不再二次入队，保持同步返回 retriedCount 语义简单）
    const result = await this.deliverChunk(
      batchId,
      failedUserIds,
      batch.type,
      batch.title as Record<string, string>,
      batch.content as Record<string, string>,
    );

    // 重算批次计数（deliverChunk 已 increment；这里校正为真实值——delivered=有行数，
    // failed=totalRecipients - delivered）
    const totalDelivered = await db.notification.count({ where: { batchId } });
    await db.notificationBatch.update({
      where: { id: batchId },
      data: {
        deliveredCount: totalDelivered,
        failedCount: Math.max(batch.totalRecipients - totalDelivered, 0),
      },
    });

    return {
      batchId,
      retriedCount: failedUserIds.length,
      deliveredCount: totalDelivered,
      failedCount: Math.max(batch.totalRecipients - totalDelivered, 0),
      push: { success: result.pushSuccess, mockFlag: true, error: result.pushError },
    };
  }

  /**
   * target → userIds 解析
   *
   * - ALL_CUSTOMERS：role=CUSTOMER 且 status!=DELETED
   * - ALL_RIDERS：role=RIDER 且 status!=DELETED
   * - SPECIFIC_USERS：校验 userIds 全部存在，缺失抛 E-ADMIN-NOTIF-001
   *
   * 群发超 BROADCAST_HARD_LIMIT 抛 E-ADMIN-NOTIF-002（防误操作超大群发）
   */
  private async resolveTargetUserIds(
    target: NotificationTargetView,
    userIds?: string[],
  ): Promise<string[]> {
    if (target === 'SPECIFIC_USERS') {
      const ids = userIds ?? [];
      if (ids.length === 0) {
        // refine 已拦，双保险
        throw new BadRequestException({
          code: 'E-ADMIN-NOTIF-001',
          message: 'userIds is required when target=SPECIFIC_USERS',
        });
      }
      const existing = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((u) => u.id));
      const missing = ids.filter((id) => !existingIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          code: 'E-ADMIN-NOTIF-001',
          message: `Some userIds do not exist: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`,
        });
      }
      return ids;
    }

    // ALL_CUSTOMERS / ALL_RIDERS
    const role = target === 'ALL_CUSTOMERS' ? 'CUSTOMER' : 'RIDER';
    const users = await db.user.findMany({
      where: { role, status: { not: 'DELETED' } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > BROADCAST_HARD_LIMIT) {
      throw new BadRequestException({
        code: 'E-ADMIN-NOTIF-002',
        message: `Broadcast size ${ids.length} exceeds hard limit ${BROADCAST_HARD_LIMIT}`,
      });
    }
    return ids;
  }
}
