/**
 * Rider Notification Controller — 骑手端通知四端点（批A A3，2026-09-09）
 *
 * 现状缺口（方案v2 §1#18）：client 通知控制器 @Roles('CUSTOMER')，RIDER 角色调 /client/* 会
 * 403（DeviceTypeGuard 强制 deviceType=client_app + role 不符）——rider 通知页永久 mock。
 *
 * 本控制器与 client NotificationController（user.controller.ts）路由同构，仅前缀/角色不同：
 *   GET   /api/v1/rider/notifications           通知列表（+onlyUnread）
 *   GET   /api/v1/rider/notifications/unread-count
 *   PATCH /api/v1/rider/notifications/:id/read
 *   POST  /api/v1/rider/notifications/read-all
 *
 * 复用 NotificationService（批A 从 user.service 抽出的共享实现，行为回归不变）。
 * 三道全局 Guard（Jwt → DeviceType → Roles）已注册，controller 不写 @UseGuards。
 */
import { Controller, Get, Patch, Post, Param, Request, Query, Inject, HttpCode, HttpStatus } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { Audit } from '../../shared/decorators/audit.decorator';
import type { RequestUser } from '../auth/strategies/jwt.strategy';

@Controller('api/v1/rider/notifications')
@Roles('RIDER')
export class RiderNotificationController {
  constructor(@Inject(NotificationService) private readonly notifications: NotificationService) {}

  /** 通知列表（最新 100 条，按偏好过滤；+onlyUnread=true 只看未读） */
  @Get()
  async list(
    @Request() req: { user: RequestUser },
    @Query('onlyUnread') onlyUnread?: string,
  ) {
    const data = await this.notifications.listNotifications(req.user.sub, onlyUnread === 'true');
    return { success: true as const, data };
  }

  /** 未读数量（与列表同步偏好过滤） */
  @Get('unread-count')
  async unreadCount(@Request() req: { user: RequestUser }) {
    const data = await this.notifications.getUnreadCount(req.user.sub);
    return { success: true as const, data };
  }

  /** 标记单条已读（幂等） */
  @Patch(':id/read')
  @Audit({ resource: 'Notification', skip: true })
  async markRead(@Request() req: { user: RequestUser }, @Param('id') id: string) {
    const data = await this.notifications.markNotificationRead(req.user.sub, id);
    return { success: true as const, data };
  }

  /** 全部标记已读（幂等） */
  @Post('read-all')
  @Audit({ resource: 'Notification', skip: true })
  @HttpCode(HttpStatus.OK)
  async markAllRead(@Request() req: { user: RequestUser }) {
    const data = await this.notifications.markAllNotificationsRead(req.user.sub);
    return { success: true as const, data };
  }
}
