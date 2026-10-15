/**
 * Notification Service — 站内信通用实现（批A A3，2026-09-09）
 *
 * 从 user.service.ts L321-429 抽出（client 四端点行为回归不变，路由/权限不动）：
 *   GET /client/notifications (+onlyUnread) / GET unread-count / PATCH :id/read / POST read-all
 *   GET/PATCH /client/user/notification-preferences（偏好读取/更新仍留 UserService 对外，
 *   底层偏好解析逻辑收敛到本 service 供 list/unread-count 过滤复用）
 *
 * rider 侧（A3 新增）：/rider/notifications 四端点复用本 service（RiderNotificationController）。
 *
 * 偏好（P17 B1 + 批A 扩展）：User.notificationPreferences JSON，null/缺省 key 兜底 true；
 * 批A 扩 riderTasks/wallet 两键（向后兼容——老用户 JSON 无此 key 时默认收）。
 *
 * DI：tsx 无 decorator metadata，controller 必须显式 @Inject(NotificationService)。
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { db } from '../../shared/db';
import { Prisma, NotificationType } from '../../prisma/client';
import { NotificationItem } from '@meimart/api-contract';
import type { NotificationPreferences as NotificationPreferencesView } from '@meimart/api-contract';

type NotificationDTO = z.infer<typeof NotificationItem>;
type UpdatePrefsInput = {
  orderUpdates?: boolean;
  promotions?: boolean;
  system?: boolean;
  riderTasks?: boolean;
  wallet?: boolean;
};

/** 通知偏好视图（批A：riderTasks/wallet 缺省兜底 true 向后兼容） */
export interface NotificationPrefsView {
  orderUpdates: boolean;
  promotions: boolean;
  system: boolean;
  riderTasks: boolean;
  wallet: boolean;
}

/** 全部通知类型（偏好 → enabled types 过滤用） */
const ALL_NOTIFICATION_TYPES = [
  'ORDER_UPDATE',
  'PROMOTION',
  'SYSTEM',
  'RIDER_TASK',
  'WALLET',
] as const;

@Injectable()
export class NotificationService {
  /**
   * 读取通知偏好（P17 B1 + 批A riderTasks/wallet）：null / 缺省 key 兜底 true（默认收全部）
   */
  async getNotificationPreferences(userId: string): Promise<NotificationPrefsView> {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });
    const raw = (user?.notificationPreferences ?? null) as Record<string, boolean | undefined> | null;
    return {
      orderUpdates: raw?.orderUpdates ?? true,
      promotions: raw?.promotions ?? true,
      system: raw?.system ?? true,
      riderTasks: raw?.riderTasks ?? true,
      wallet: raw?.wallet ?? true,
    };
  }

  /** 部分更新通知偏好（merge 未传 key 不变，返回更新后全量） */
  async updateNotificationPreferences(
    userId: string,
    patch: UpdatePrefsInput,
  ): Promise<NotificationPrefsView> {
    const current = await this.getNotificationPreferences(userId);
    const next = { ...current, ...patch };
    await db.user.update({
      where: { id: userId },
      data: { notificationPreferences: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  /** 偏好 → enabled NotificationType 集合（全关 = 空数组 = 列表/未读数全空） */
  private enabledNotificationTypes(prefs: NotificationPrefsView): NotificationType[] {
    const types: NotificationType[] = [];
    if (prefs.orderUpdates) types.push('ORDER_UPDATE');
    if (prefs.promotions) types.push('PROMOTION');
    if (prefs.system) types.push('SYSTEM');
    if (prefs.riderTasks) types.push('RIDER_TASK');
    if (prefs.wallet) types.push('WALLET');
    return types;
  }

  /** 通知列表（最新 100 条，按偏好过滤 enabled types；onlyUnread 只看未读） */
  async listNotifications(userId: string, onlyUnread = false): Promise<NotificationDTO[]> {
    const prefs = await this.getNotificationPreferences(userId);
    const enabledTypes = this.enabledNotificationTypes(prefs);
    const items = await db.notification.findMany({
      where: {
        userId,
        // P26 批B1（2026-10-13）：软删通知对 client/rider 侧不可见（admin readCount 聚合不过滤，见 admin-notification.service.ts）
        deletedAt: null,
        ...(onlyUnread ? { isRead: false } : {}),
        type: { in: enabledTypes },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((n) => ({
      id: n.id,
      userId: n.userId,
      type: n.type,
      title: n.title as Record<string, string>,
      content: n.content as Record<string, string>,
      isRead: n.isRead,
      data: n.data as Record<string, unknown> | null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  /** 标记单条已读（幂等；不存在抛 E-USER-007） */
  async markNotificationRead(userId: string, notificationId: string): Promise<{ success: boolean }> {
    const existing = await db.notification.findFirst({
      where: { id: notificationId, userId, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'Notification not found' });
    }
    await db.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });
    return { success: true };
  }

  /** 全部标记已读（幂等 updateMany；P26 批B1：软删通知不参与） */
  async markAllNotificationsRead(userId: string): Promise<{ success: boolean }> {
    await db.notification.updateMany({
      where: { userId, isRead: false, deletedAt: null },
      data: { isRead: true },
    });
    return { success: true };
  }

  /** 未读数量（与 listNotifications 同步偏好过滤；P26 批B1：软删通知不参与） */
  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const prefs = await this.getNotificationPreferences(userId);
    const enabledTypes = this.enabledNotificationTypes(prefs);
    const count = await db.notification.count({
      where: { userId, isRead: false, deletedAt: null, type: { in: enabledTypes } },
    });
    return { count };
  }

  /**
   * P26 批B1（2026-10-13）：软删单条通知（D9 拍板不物理删）。
   * 归属硬校验：非本人按 404 处理（仓内惯例，不暴露存在性）。
   */
  async deleteNotification(userId: string, notificationId: string): Promise<{ success: boolean }> {
    const existing = await db.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'E-USER-007', message: 'Notification not found' });
    }
    await db.notification.update({
      where: { id: notificationId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  /**
   * P26 批B1：批量软删通知。ids 空 400 / 上限 100 / 全部限定本人（updateMany where 天然限定）。
   */
  async deleteNotifications(userId: string, ids: string[]): Promise<{ success: boolean }> {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestException({ code: 'E-USER-008', message: 'ids is required' });
    }
    if (ids.length > 100) {
      throw new BadRequestException({ code: 'E-USER-009', message: 'ids limit 100' });
    }
    await db.notification.updateMany({
      where: { id: { in: ids }, userId },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }
}

// 保持 re-export：ALL_NOTIFICATION_TYPES 供事件侧校验 type 合法性（不改 DB enum 语义）
export { ALL_NOTIFICATION_TYPES };
export type { NotificationPreferencesView };
