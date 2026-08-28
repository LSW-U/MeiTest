/**
 * Admin Notification Service — 后台通知/推送业务（admin-web 优化方案 批次2 2026-08-29）
 *
 * 设计：
 *   - MVP 真链路 = 写 Notification 表 + 前端拉取（/client/notifications）
 *   - PUSH 通道走 NotifyFactory dev stub（无 FCM/APNs/deviceToken 表，mockFlag=true 仅日志）
 *   - 群发目标：ALL_CUSTOMERS / ALL_RIDERS / SPECIFIC_USERS（指定 userIds）
 *   - 写表用 createMany 批量插入（避免 N 次 create）
 *   - 发送历史：按 createdAt desc offset 分页（群发按「批次」聚合需建表，MVP 用 deliveredCount 字段近似）
 *
 * 错误码：
 *   - E-ADMIN-NOTIF-001 target=SPECIFIC_USERS 但 userIds 含不存在用户（部分校验，列出缺失 ID）
 *   - E-ADMIN-NOTIF-002 群发规模超上限（ALL_CUSTOMERS/ALL_RIDERS 单次 > 50000，防误操作）
 *   - E-COMMON-001（zod 校验，controller pipe 抛）
 *
 * NotifyFactory 注入：tsx 无 decorator metadata，必须 @Inject('NotifyFactoryToken')，
 *   token 由所在 module 用 { provide: 'NotifyFactoryToken', useExisting: NotifyFactory } 注册。
 */
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { Prisma } from '../../prisma/client';
import type { AdminSendNotificationRequest } from '@meimart/api-contract';
import {
  AdminSendNotificationResponseData,
  AdminNotificationHistoryItem,
  AdminNotificationType,
  NotificationTarget,
} from '@meimart/api-contract';

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

/** 群发规模上限（ALL_CUSTOMERS/ALL_RIDERS 单次群发防误操作硬上限） */
const BROADCAST_HARD_LIMIT = 50_000;

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
  ) {}

  /**
   * 发送通知（群发/指定）
   *
   * 流程：
   *   1. 解析 target → userIds（ALL_CUSTOMERS/ALL_RIDERS 查 DB；SPECIFIC_USERS 校验存在性）
   *   2. createMany 批量写 Notification 表（真链路，前端拉取即可见）
   *   3. NotifyFactory.sendMulti PUSH 通道（dev stub，mockFlag=true）—— 仅尝试，失败不阻断写表
   *
   * 返回：deliveredCount（写表条数）+ push 结果（mockFlag 提示前端未真实推送）
   */
  async send(input: AdminSendNotificationRequestView): Promise<AdminSendNotificationResponseView> {
    const userIds = await this.resolveTargetUserIds(input.target, input.userIds);

    if (userIds.length === 0) {
      // 无收件人（如 ALL_RIDERS 但库内无骑手）：写 0 条，PUSH 跳过，前端展示 0 投递
      return {
        deliveredCount: 0,
        push: { success: false, mockFlag: true, error: 'no recipients' },
      };
    }

    // 批量写 Notification 表（真链路：前端 /client/notifications 即可拉到）
    const rows = userIds.map((userId) => ({
      userId,
      type: input.type as never,
      title: input.title as unknown as Prisma.InputJsonValue,
      content: input.content as unknown as Prisma.InputJsonValue,
      isRead: false,
      data: (input.data ?? null) as unknown as Prisma.InputJsonValue,
    }));
    const createResult = await db.notification.createMany({ data: rows });
    const deliveredCount = createResult.count;

    // PUSH 通道（dev stub）。群发量大时 sendMulti 会逐个调用 stub，MVP 可接受（stub 仅日志）。
    // 失败不阻断：写表是真链路，PUSH 是增强；任一 userId PUSH 失败只记录 error。
    let pushSuccess = true;
    let pushError: string | null = null;
    if (this.notifyFactory) {
      try {
        // 取首个 userId 作代表发送（群发 PUSH 真实场景需 deviceToken 表，MVP stub 不区分用户）
        const results = await this.notifyFactory.sendMulti(
          {
            userId: userIds[0],
            type: input.type,
            title: input.title,
            body: input.content,
            data: input.data ?? undefined,
          },
          ['PUSH'],
        );
        const pushRes = results?.PUSH;
        if (pushRes && !pushRes.success) {
          pushSuccess = false;
          pushError = pushRes.error ?? 'push failed';
        }
      } catch (e) {
        pushSuccess = false;
        pushError = (e as Error).message;
      }
    } else {
      pushSuccess = false;
      pushError = 'NotifyFactory not available';
    }

    return {
      deliveredCount,
      push: { success: pushSuccess, mockFlag: true, error: pushError },
    };
  }

  /**
   * 发送历史列表（offset 分页）
   *
   * MVP 无「批次」表，历史按 Notification 行倒序展示，每条 deliveredCount=1（单行近似）。
   * 真正「按批次聚合」（含真实 target / deliveredCount=批次规模）需建 NotificationBatch 表，
   * 列待办（方案 §四 暂缓增强）。
   *
   * **MVP 不支持 target 筛选**（P2-1 修复 2026-08-29）：
   *   - 单行 Notification 不存 target，无法按目标过滤；契约已删 query.target。
   *   - 响应不再返 target 字段（契约 AdminNotificationHistoryItem 已移除 target），
   *     避免前端按 target 展示标签却拿到兜底假值。
   *   - 仅支持 type 行级筛选。
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

    const where: Prisma.NotificationWhereInput = {};
    if (opts.type) where.type = opts.type as never;

    const [rows, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      db.notification.count({ where }),
    ]);

    return {
      // deliveredCount=1：MVP 单行近似（非批次规模），见方法 JSDoc 语义说明
      items: rows.map((r) => ({
        id: r.id,
        type: r.type as AdminNotificationTypeView,
        deliveredCount: 1,
        title: r.title as Record<string, string>,
        content: r.content as Record<string, string>,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      hasMore: skip + rows.length < total,
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
